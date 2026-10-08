import { getSupabase } from './supabase';
import { OrganizationService } from './organizations';
import { UserError } from './errors';
import { DEFAULT_THEME_ACCENT, THEME_ACCENTS } from '../utils/themeAccents';
import { printedDate, rateOf, type PrintDocument, type PrintKind, type PrintLine, type PrintParty, type PrintTotal } from '../utils/printDocument';

const PARTY_COLUMNS = 'display_name, legal_name, billing_address, city, kra_pin, email, phone';

const KIND_LABEL: Record<PrintKind, string> = {
  invoice: 'Invoice',
  'credit-note': 'Credit note',
  estimate: 'Estimate',
  'sales-receipt': 'Sales receipt',
  'sales-order': 'Sales order',
  'purchase-order': 'Purchase order',
};

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const textOrNull = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

function partyOf(value: any): PrintParty | null {
  const party = one(value);
  if (!party) return null;
  const name = textOrNull(party.display_name) || textOrNull(party.legal_name) || '';
  const legalName = textOrNull(party.legal_name);
  return {
    name,
    legalName: legalName && legalName !== name ? legalName : null,
    address: textOrNull(party.billing_address),
    city: textOrNull(party.city),
    kraPin: textOrNull(party.kra_pin),
    email: textOrNull(party.email),
    phone: textOrNull(party.phone),
  };
}

const byPosition = (a: any, b: any) => (Number(a.line_position) || 0) - (Number(b.line_position) || 0);

/** Lines that carry their own quantity, price and rate: estimates, orders, receipts, credits. */
function pricedLines(rows: any[] | null | undefined, priceColumn: 'unit_price_cents' | 'unit_cost_cents'): PrintLine[] {
  return [...(rows || [])].sort(byPosition).map((line) => {
    const amountCents = Number(line.amount_cents) || 0;
    const taxCents = Number(line.tax_cents) || 0;
    return {
      description: line.description,
      quantity: line.quantity == null ? null : Number(line.quantity),
      unitPriceCents: line[priceColumn] == null ? null : Number(line[priceColumn]),
      taxRate: line.tax_rate == null ? rateOf(amountCents, taxCents) : Number(line.tax_rate),
      amountCents,
      taxCents,
    };
  });
}

/** Subtotal, VAT and total as the document stored them. */
function totalsOf(row: any, totalLabel = 'Total'): PrintTotal[] {
  return [
    { label: 'Subtotal', cents: Number(row.subtotal_cents) || 0 },
    { label: 'VAT', cents: Number(row.tax_cents) || 0 },
    { label: totalLabel, cents: Number(row.total_cents) || 0, emphasis: 'total' },
  ];
}

async function fetchOne(table: string, columns: string, orgId: string, id: string, kind: PrintKind, filter?: [string, string]) {
  let request = getSupabase().from(table).select(columns).eq('org_id', orgId).eq('id', id);
  if (filter) request = request.eq(filter[0], filter[1]);
  const { data, error } = await request.maybeSingle();
  if (error) throw error;
  if (!data) throw new UserError(`${KIND_LABEL[kind]} not found in this organization.`, 404);
  return data as any;
}

/**
 * A law firm's fee note (an invoice on a matter): professional fees and
 * disbursements under their own headings and totals, as the Advocates
 * (Accounts) Rules keep them apart, withholding tax shown apart from money
 * received, and the KRA eTIMS number when the firm has recorded one. It
 * never claims eTIMS submission: the number is entered by hand.
 */
function feeNoteModel(row: any, base: Pick<PrintDocument, 'kind' | 'accent' | 'company' | 'footer'>, paymentDetails: string | null, baseCurrency: string): PrintDocument {
  const lines = [...(row.invoice_lines || [])].sort(byPosition);
  const section = (kind: string) => (kind === 'DISBURSEMENT' ? 'Disbursements' : 'Professional fees');
  const printed: PrintLine[] = [...lines.filter((line) => line.line_kind !== 'DISBURSEMENT'), ...lines.filter((line) => line.line_kind === 'DISBURSEMENT')]
    .map((line: any) => {
      const amountCents = Number(line.amount_cents) || 0;
      const taxCents = Number(line.tax_cents) || 0;
      return { section: section(line.line_kind), description: line.description, quantity: null, unitPriceCents: null, taxRate: rateOf(amountCents, taxCents), amountCents, taxCents };
    });
  const fees = printed.filter((line) => line.section === 'Professional fees').reduce((sum, line) => sum + line.amountCents, 0);
  const disbursed = printed.filter((line) => line.section === 'Disbursements').reduce((sum, line) => sum + line.amountCents, 0);
  const isVoid = row.status === 'VOID';
  const payments = ((row.invoice_payments || []) as any[]).filter((payment) => !payment.reversed_at);
  const withheld = payments.reduce((sum, payment) => sum + (Number(payment.wht_cents) || 0), 0);
  const paid = payments.reduce((sum, payment) => sum + (Number(payment.amount_cents) || 0), 0) - withheld;
  const balance = isVoid ? 0 : Number(row.amount_due_cents) || 0;
  const totals: PrintTotal[] = [
    { label: 'Professional fees', cents: fees },
    { label: 'Disbursements', cents: disbursed },
    { label: 'VAT on fees', cents: Number(row.tax_cents) || 0 },
    { label: 'Total', cents: Number(row.total_cents) || 0, emphasis: 'total' },
  ];
  if (!isVoid) {
    if (paid) totals.push({ label: 'Paid', cents: -paid });
    if (withheld) totals.push({ label: 'Withholding tax', cents: -withheld });
    totals.push({ label: 'Balance due', cents: balance, emphasis: 'balance' });
  }
  const matter = one(row.matter);
  const facts = [{ label: 'Date', value: printedDate(row.date) }];
  if (row.due_date) facts.push({ label: 'Due', value: printedDate(row.due_date) });
  if (matter?.matter_number) facts.push({ label: 'Matter', value: matter.matter_number });
  if (textOrNull(matter?.case_number)) facts.push({ label: 'Case', value: matter.case_number.trim() });
  if (textOrNull(row.etims_invoice_number)) facts.push({ label: 'KRA eTIMS invoice', value: row.etims_invoice_number.trim() });
  return {
    ...base,
    title: 'Fee note',
    number: row.invoice_number,
    currency: String(row.currency || baseCurrency).toUpperCase(),
    stamp: isVoid ? 'VOID' : row.status === 'PAID' ? 'PAID' : null,
    partyLabel: 'Client',
    party: partyOf(row.customer),
    facts,
    priceLabel: 'Unit price',
    lines: printed,
    totals,
    notes: [textOrNull(matter?.title) ? `Re: ${matter.title.trim()}` : null, textOrNull(row.notes)].filter(Boolean).join('\n') || null,
    paymentDetails: isVoid || balance === 0 ? null : paymentDetails,
    etims: null,
  };
}

/**
 * Invoices, credit notes, estimates, sales receipts, sales orders and
 * purchase orders as they are printed. Figures are read from the books as
 * posted; nothing here recalculates a document. A foreign-currency invoice is
 * printed in its own currency, from the foreign amounts stored on each line
 * and each payment.
 */
export class DocumentPrintService {
  static async printModel(orgId: string, kind: PrintKind, id: string): Promise<PrintDocument> {
    const organization = await OrganizationService.getOrganization(orgId);
    if (!organization) throw new UserError('Organization not found.', 404);
    const accent = (THEME_ACCENTS.find((option) => option.id === organization.themeAccent)
      || THEME_ACCENTS.find((option) => option.id === DEFAULT_THEME_ACCENT)!).swatch;
    const legalName = textOrNull(organization.legalName);
    const base = {
      kind,
      accent,
      company: {
        name: organization.name,
        legalName: legalName && legalName !== organization.name ? legalName : null,
        taxId: textOrNull(organization.taxId),
        address: textOrNull(organization.address),
        city: textOrNull(organization.city),
        phone: textOrNull(organization.phone),
        email: textOrNull(organization.email),
        website: textOrNull(organization.website),
      },
      footer: textOrNull(organization.documentFooter),
    };
    const paymentDetails = textOrNull(organization.paymentDetails);
    const baseCurrency = (organization.baseCurrency || 'KES').toUpperCase();

    switch (kind) {
      case 'invoice': {
        const row = await fetchOne('invoices', `
          *,
          invoice_lines(*),
          invoice_payments(amount_cents, foreign_amount_cents, reversed_at, wht_cents),
          credit_applications!credit_applications_invoice_fkey(amount_cents, reversed_at),
          etims_submissions(status, kra_control_code, qr_code_url, submitted_at),
          customer:customers(${PARTY_COLUMNS}),
          matter:matters!invoices_org_matter_fkey(matter_number, title, case_number, court)
        `, orgId, id, kind);
        if (row.matter_id) return feeNoteModel(row, base, paymentDetails, baseCurrency);
        const currency = String(row.currency || baseCurrency).toUpperCase();
        const foreign = currency !== baseCurrency;
        const lines: PrintLine[] = [...(row.invoice_lines || [])].sort(byPosition).map((line: any) => {
          const amountCents = Number(foreign ? line.foreign_amount_cents : line.amount_cents) || 0;
          const taxCents = Number(foreign ? line.foreign_tax_cents : line.tax_cents) || 0;
          const quantity = line.quantity == null ? null : Number(line.quantity);
          return {
            description: line.description,
            quantity,
            unitPriceCents: quantity ? Math.round(amountCents / quantity) : null,
            taxRate: rateOf(amountCents, taxCents),
            amountCents,
            taxCents,
          };
        });
        // In the base currency the document's own totals; in a foreign one
        // the foreign line amounts, which add up to its foreign total.
        const subtotalCents = foreign ? lines.reduce((sum, line) => sum + line.amountCents, 0) : Number(row.subtotal_cents) || 0;
        const taxCents = foreign ? lines.reduce((sum, line) => sum + line.taxCents, 0) : Number(row.tax_cents) || 0;
        const totalCents = foreign ? Number(row.foreign_amount_cents) || subtotalCents + taxCents : Number(row.total_cents) || 0;
        const isVoid = row.status === 'VOID';
        const payments = ((row.invoice_payments || []) as any[]).filter((payment) => !payment.reversed_at);
        const paidCents = payments.reduce((sum, payment) => sum + (Number(foreign ? payment.foreign_amount_cents : payment.amount_cents) || 0), 0);
        const creditedCents = foreign ? 0 : ((row.credit_applications || []) as any[])
          .filter((use) => !use.reversed_at)
          .reduce((sum, use) => sum + (Number(use.amount_cents) || 0), 0);
        const amountDueCents = Number(row.amount_due_cents) || 0;
        const balanceCents = isVoid || amountDueCents === 0 ? 0 : foreign ? Math.max(totalCents - paidCents, 0) : amountDueCents;

        const totals: PrintTotal[] = [
          { label: 'Subtotal', cents: subtotalCents },
          { label: 'VAT', cents: taxCents },
          { label: 'Total', cents: totalCents, emphasis: 'total' },
        ];
        if (!isVoid) {
          if (paidCents) totals.push({ label: 'Paid', cents: -paidCents });
          if (creditedCents) totals.push({ label: 'Credit applied', cents: -creditedCents });
          totals.push({ label: 'Balance due', cents: balanceCents, emphasis: 'balance' });
        }
        const signed = ((row.etims_submissions || []) as any[])
          .filter((submission) => (submission.status === 'VERIFIED' || submission.status === 'SUCCESS') && textOrNull(submission.kra_control_code))
          .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];
        const facts = [{ label: 'Date', value: printedDate(row.date) }];
        if (row.due_date) facts.push({ label: 'Due', value: printedDate(row.due_date) });
        return {
          ...base,
          title: signed ? 'Tax invoice' : 'Invoice',
          number: row.invoice_number,
          currency,
          stamp: isVoid ? 'VOID' : row.status === 'PAID' ? 'PAID' : null,
          partyLabel: 'Bill to',
          party: partyOf(row.customer),
          facts,
          priceLabel: 'Unit price',
          lines,
          totals,
          notes: textOrNull(row.notes),
          paymentDetails: isVoid || balanceCents === 0 ? null : paymentDetails,
          etims: signed ? { controlCode: signed.kra_control_code, qrCodeUrl: textOrNull(signed.qr_code_url) } : null,
        };
      }

      case 'credit-note': {
        const row = await fetchOne('credit_notes', `
          *,
          credit_note_lines(*),
          customer:customers(${PARTY_COLUMNS}),
          invoice:invoices!credit_notes_org_invoice_fkey(invoice_number)
        `, orgId, id, kind, ['kind', 'CUSTOMER']);
        const isVoid = row.status === 'VOID';
        const totalCents = Number(row.total_cents) || 0;
        const remainingCents = Number(row.remaining_cents) || 0;
        const totals = totalsOf(row, 'Total credit');
        if (!isVoid && remainingCents !== totalCents) {
          totals.push({ label: 'Used', cents: -(totalCents - remainingCents) });
          totals.push({ label: 'Credit remaining', cents: remainingCents, emphasis: 'balance' });
        }
        const facts = [{ label: 'Date', value: printedDate(row.credit_date) }];
        const against = one(row.invoice)?.invoice_number;
        if (against) facts.push({ label: 'Against invoice', value: against });
        if (textOrNull(row.reference)) facts.push({ label: 'Reference', value: row.reference.trim() });
        return {
          ...base,
          title: 'Credit note',
          number: row.number,
          currency: String(row.currency || baseCurrency).toUpperCase(),
          stamp: isVoid ? 'VOID' : null,
          partyLabel: 'Credit to',
          party: partyOf(row.customer),
          facts,
          priceLabel: 'Unit price',
          lines: pricedLines(row.credit_note_lines, 'unit_price_cents'),
          totals,
          notes: textOrNull(row.memo),
          paymentDetails: null,
          etims: null,
        };
      }

      case 'estimate': {
        const row = await fetchOne('estimates', `*, estimate_lines(*), customer:customers(${PARTY_COLUMNS})`, orgId, id, kind);
        const facts = [{ label: 'Date', value: printedDate(row.estimate_date) }];
        if (row.expiry_date) facts.push({ label: 'Valid until', value: printedDate(row.expiry_date) });
        return {
          ...base,
          title: 'Estimate',
          number: row.estimate_number,
          currency: String(row.currency || baseCurrency).toUpperCase(),
          stamp: null,
          partyLabel: 'Prepared for',
          party: partyOf(row.customer),
          facts,
          priceLabel: 'Unit price',
          lines: pricedLines(row.estimate_lines, 'unit_price_cents'),
          totals: totalsOf(row),
          notes: textOrNull(row.notes),
          paymentDetails,
          etims: null,
        };
      }

      case 'sales-order': {
        const row = await fetchOne('sales_orders', `*, sales_order_lines(*), customer:customers(${PARTY_COLUMNS})`, orgId, id, kind);
        const facts = [{ label: 'Date', value: printedDate(row.order_date) }];
        if (row.promised_date) facts.push({ label: 'Promised by', value: printedDate(row.promised_date) });
        const cancelled = row.status === 'CANCELLED';
        return {
          ...base,
          title: 'Sales order',
          number: row.order_number,
          currency: String(row.currency || baseCurrency).toUpperCase(),
          stamp: cancelled ? 'CANCELLED' : null,
          partyLabel: 'Customer',
          party: partyOf(row.customer),
          facts,
          priceLabel: 'Unit price',
          lines: pricedLines(row.sales_order_lines, 'unit_price_cents'),
          totals: totalsOf(row),
          notes: textOrNull(row.notes),
          paymentDetails: cancelled ? null : paymentDetails,
          etims: null,
        };
      }

      case 'sales-receipt': {
        const row = await fetchOne('cash_transactions', `
          *,
          cash_transaction_lines(*),
          customer:customers(${PARTY_COLUMNS}),
          money_account:accounts!cash_transactions_org_money_account_fkey(name)
        `, orgId, id, kind, ['kind', 'SALES_RECEIPT']);
        const isVoid = row.status === 'VOID';
        const party = partyOf(row.customer)
          || (textOrNull(row.payee_name) ? { name: row.payee_name.trim(), legalName: null, address: null, city: null, kraPin: null, email: null, phone: null } : null);
        const facts = [{ label: 'Date', value: printedDate(row.txn_date) }];
        const paidInto = textOrNull(one(row.money_account)?.name);
        if (paidInto) facts.push({ label: 'Paid into', value: paidInto });
        if (textOrNull(row.reference)) facts.push({ label: 'Reference', value: row.reference.trim() });
        return {
          ...base,
          title: 'Sales receipt',
          number: row.number,
          currency: baseCurrency,
          stamp: isVoid ? 'VOID' : 'PAID',
          partyLabel: 'Received from',
          party,
          facts,
          priceLabel: 'Unit price',
          lines: pricedLines(row.cash_transaction_lines, 'unit_price_cents'),
          totals: totalsOf(row, 'Total paid'),
          notes: textOrNull(row.memo),
          paymentDetails: null,
          etims: null,
        };
      }

      case 'purchase-order': {
        const row = await fetchOne('purchase_orders', `*, purchase_order_lines(*), vendor:vendors(${PARTY_COLUMNS})`, orgId, id, kind);
        const facts = [{ label: 'Date', value: printedDate(row.order_date) }];
        if (row.expected_date) facts.push({ label: 'Expected by', value: printedDate(row.expected_date) });
        return {
          ...base,
          title: 'Purchase order',
          number: row.number,
          currency: String(row.currency || baseCurrency).toUpperCase(),
          stamp: row.status === 'CANCELLED' ? 'CANCELLED' : null,
          partyLabel: 'Supplier',
          party: partyOf(row.vendor),
          facts,
          priceLabel: 'Unit cost',
          lines: pricedLines(row.purchase_order_lines, 'unit_cost_cents'),
          totals: totalsOf(row),
          notes: textOrNull(row.memo),
          paymentDetails: null,
          etims: null,
        };
      }
    }
  }
}
