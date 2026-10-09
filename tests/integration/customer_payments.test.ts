// One payment from a customer across several invoices, through the service
// and PostgREST: shared oldest due first, the rest kept as credit, refused
// on a law firm's fee notes, and reversed whole.
import assert from 'node:assert/strict';
import test from 'node:test';
import { InvoiceService } from '../../src/server/invoices';
import { CustomerPaymentService } from '../../src/server/customerPayments';
import { OrganizationService } from '../../src/server/organizations';
import { CustomerService } from '../../src/server/customers';
import { MatterService } from '../../src/server/matters';
import { FeeNoteService } from '../../src/server/feeNotes';
import { ORG, OWNER, CUSTOMER, BANK, SALES, sql, uuid, refused } from './helpers';

const invoice = (issueDate: string, dueDate: string, cents: number) => InvoiceService.createInvoice({
  orgId: ORG, customerId: CUSTOMER, issueDate, dueDate, currency: 'KES',
  lines: [{ description: 'Cement', accountId: SALES, amountCents: cents }], idempotencyKey: uuid(), createdBy: OWNER,
});
const receivable = () => Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l
  JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${ORG}' AND a.code = '1100'`));

test('one deposit pays the oldest invoice, part pays the next, keeps the rest as credit, and reverses whole', async () => {
  const older = await invoice('2026-09-01', '2026-09-30', 40_000);
  const newer = await invoice('2026-09-10', '2026-10-10', 50_000);
  const before = receivable();
  const payment = await CustomerPaymentService.receive({
    orgId: ORG, customerId: CUSTOMER, paymentDate: '2026-10-02', depositAccountId: BANK, amountCents: 100_000,
    allocations: null, reference: 'EFT 4411', actor: OWNER, idempotencyKey: uuid(),
  });
  assert.match(payment.number, /^PMT-2026-\d{5}$/);
  assert.equal(payment.appliedCents, 90_000);
  assert.equal(payment.creditCents, 10_000);
  const status = (id: string) => sql(`SELECT status || ' ' || amount_due_cents FROM public.invoices WHERE id = '${id}'`);
  assert.equal(status(older), 'PAID 0');
  assert.equal(status(newer), 'PAID 0');
  assert.equal(receivable(), before - 100_000, 'receivables fall by the whole deposit, credit included');
  assert.equal(sql(`SELECT count(*) FROM public.journal_entries WHERE source_type = 'CUSTOMER_PAYMENT' AND org_id = '${ORG}'`), '1', 'one entry for one deposit');
  const listed = (await CustomerPaymentService.list(ORG, { customerId: CUSTOMER })).find((row) => row.id === payment.id)!;
  assert.deepEqual(listed.invoices.map((share) => share.amountCents).sort(), [40_000, 50_000]);
  assert.equal(listed.credit?.remainingCents, 10_000);

  // A share cannot be reversed on its own; the whole payment goes back.
  const share = sql(`SELECT id FROM public.invoice_payments WHERE invoice_id = '${older}' AND customer_payment_id = '${payment.id}'`);
  await refused(InvoiceService.reversePayment(ORG, older, share, '2026-10-03', 'Bounced', OWNER), /Reverse that payment instead/);
  const reversed = await CustomerPaymentService.reverse(ORG, payment.id, '2026-10-03', 'The cheque bounced', OWNER);
  assert.notEqual(sql(`SELECT status FROM public.invoices WHERE id = '${older}'`), 'PAID');
  assert.equal(Number(sql(`SELECT amount_due_cents FROM public.invoices WHERE id = '${older}'`)), 40_000);
  assert.equal(Number(sql(`SELECT amount_due_cents FROM public.invoices WHERE id = '${newer}'`)), 50_000);
  assert.equal(receivable(), before, 'receivables are back where they were');
  assert.equal(sql(`SELECT status FROM public.credit_notes WHERE customer_payment_id = '${payment.id}'`), 'VOID', 'the credit is withdrawn');
  // Asking twice returns the first reversal.
  const again = await CustomerPaymentService.reverse(ORG, payment.id, '2026-10-03', 'Again', OWNER);
  assert.equal(again.reversalJournalEntryId, reversed.reversalJournalEntryId);

  // Chosen amounts, and more than is owed refused.
  const chosen = await CustomerPaymentService.receive({
    orgId: ORG, customerId: CUSTOMER, paymentDate: '2026-10-04', depositAccountId: BANK, amountCents: 30_000,
    allocations: [{ invoiceId: newer, amountCents: 30_000 }], actor: OWNER, idempotencyKey: uuid(),
  });
  assert.equal(chosen.creditCents, 0);
  assert.equal(Number(sql(`SELECT amount_due_cents FROM public.invoices WHERE id = '${newer}'`)), 20_000);
  assert.equal(Number(sql(`SELECT amount_due_cents FROM public.invoices WHERE id = '${older}'`)), 40_000, 'the older invoice is left alone');
  await refused(CustomerPaymentService.receive({
    orgId: ORG, customerId: CUSTOMER, paymentDate: '2026-10-04', depositAccountId: BANK, amountCents: 30_000,
    allocations: [{ invoiceId: newer, amountCents: 25_000 }], actor: OWNER, idempotencyKey: uuid(),
  }), /put no more than that/);
});

test('in a law firm a fee note is settled from its matter, not by a payment across invoices', async () => {
  const lawOrg = await OrganizationService.createOrganization({ name: 'Mfano Advocates (payments test)', country: 'Kenya', edition: 'law' } as any, OWNER);
  const client = await CustomerService.createCustomer(lawOrg, { displayName: 'Mteja Mfano' } as any);
  const matter = await MatterService.create(lawOrg, OWNER, { title: 'Mfano v Mfano', clientId: client, matterType: 'LITIGATION', billingMethod: 'HOURLY', defaultRateCents: 1_000_000, openedOn: '2026-10-01' });
  await MatterService.logTime(lawOrg, matter, OWNER, { entryDate: '2026-10-02', hours: 1, description: 'Advice', billable: true } as any);
  const unbilled = await MatterService.unbilled(lawOrg, matter);
  const feeNote = await FeeNoteService.create(lawOrg, OWNER, {
    matterId: matter, issueDate: '2026-10-03', dueDate: '2026-10-17', timeEntryIds: unbilled.timeEntries.map((e: any) => e.id),
    disbursementIds: [], vatRatePercent: 0, idempotencyKey: uuid(),
  } as any);
  const officeBank = sql(`SELECT id FROM public.accounts WHERE org_id = '${lawOrg}' AND code = '1000'`);
  await refused(CustomerPaymentService.receive({
    orgId: lawOrg, customerId: client, paymentDate: '2026-10-05', depositAccountId: officeBank, amountCents: 1_000_000,
    allocations: [{ invoiceId: feeNote, amountCents: 1_000_000 }], actor: OWNER, idempotencyKey: uuid(),
  }), /settled from its matter/);
  const kept = await CustomerPaymentService.receive({
    orgId: lawOrg, customerId: client, paymentDate: '2026-10-05', depositAccountId: officeBank, amountCents: 1_000_000,
    allocations: null, actor: OWNER, idempotencyKey: uuid(),
  });
  assert.equal(kept.appliedCents, 0, 'oldest-first sharing passes fee notes by');
  assert.equal(Number(sql(`SELECT amount_due_cents FROM public.invoices WHERE id = '${feeNote}'`)), 1_000_000);
});
