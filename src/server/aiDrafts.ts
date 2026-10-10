import { getSupabase } from './supabase';
import { UserError } from './errors';
import { organizationToday } from './organizationDates';
import { InvoiceService } from './invoices';
import { MatterService } from './matters';
import { ChurchReportService } from './churchReports';
import { WorkersAiService, type AiCaller } from './workersAi';
import { plainProse } from '../utils/workersAi';
import { monthLabel, previousMonth } from '../utils/aiQuestions';
import {
  FEE_NOTE_PROMPT, feeNoteInput, reminderInput, reminderPrompt, treasurerInput, treasurerPrompt,
  type DraftLanguage,
} from '../utils/aiDrafts';

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

async function organizationRow(orgId: string) {
  const { data, error } = await getSupabase().from('organizations')
    .select('name, base_currency, payment_details, edition').eq('id', orgId).maybeSingle();
  if (error) throw error;
  if (!data) throw new UserError('Organization not found.', 404);
  return data as { name: string; base_currency: string | null; payment_details: string | null; edition: string | null };
}

/** Drafts for a person to read, change and send themselves. Nothing here sends or saves anything. */
export class DraftService {
  /** A payment reminder for one invoice that still has money owing. */
  static async invoiceReminder(caller: AiCaller, invoiceId: string, language: DraftLanguage) {
    const ai = await WorkersAiService.assertAvailable(caller);
    const [invoice, org, today] = await Promise.all([
      InvoiceService.getInvoice(caller.orgId, invoiceId),
      organizationRow(caller.orgId),
      organizationToday(caller.orgId),
    ]);
    if (['VOID', 'DRAFT', 'PAID'].includes(invoice.status) || invoice.amountDueCents <= 0) {
      throw new UserError(`Invoice ${invoice.invoiceNumber} has nothing owing, so there is nothing to remind the customer about.`);
    }
    const { data: customer, error } = await getSupabase().from('customers')
      .select('display_name, email').eq('org_id', caller.orgId).eq('id', invoice.customerId).maybeSingle();
    if (error) throw error;

    // A foreign-currency invoice is owed in its own currency, as it is printed.
    const base = org.base_currency || 'KES';
    const currency = invoice.currency || base;
    const foreign = currency !== base && invoice.foreignAmountCents != null;
    const totalCents = foreign ? Number(invoice.foreignAmountCents) : invoice.totalCents;
    const paidForeign = invoice.payments.filter((p: any) => !p.reversedAt).reduce((sum: number, p: any) => sum + (Number(p.foreignAmountCents) || 0), 0);
    const amountDueCents = foreign ? Math.max(totalCents - paidForeign, 0) : invoice.amountDueCents;

    const reply = await WorkersAiService.write(caller, ai, {
      feature: 'draft.reminder',
      system: reminderPrompt(language),
      user: reminderInput({
        businessName: org.name, customerName: customer?.display_name || 'Customer', invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate, dueDate: invoice.dueDate, daysOverdue: invoice.dueDate ? daysBetween(invoice.dueDate, today) : 0,
        totalCents, amountDueCents, currency, paymentDetails: org.payment_details,
      }),
      maxTokens: 400,
    });
    const text = plainProse(reply.text, 1500);
    if (!text) throw new UserError('No reminder came back. Try again.', 502);
    return {
      text,
      subject: `Invoice ${invoice.invoiceNumber}: payment reminder`,
      email: customer?.email || null,
    };
  }

  /** A fee note narrative from the chosen time entries and disbursements of one matter. */
  static async feeNoteNarrative(caller: AiCaller, matterId: string, timeEntryIds: string[], disbursementIds: string[]) {
    const ai = await WorkersAiService.assertAvailable(caller);
    const matter = await MatterService.get(caller.orgId, matterId) as any;
    const supabase = getSupabase();
    const [time, costs] = await Promise.all([
      timeEntryIds.length
        ? supabase.from('time_entries').select('entry_date, hours, description')
          .eq('org_id', caller.orgId).eq('matter_id', matterId).in('id', timeEntryIds).order('entry_date')
        : Promise.resolve({ data: [], error: null }),
      disbursementIds.length
        ? supabase.from('disbursements').select('incurred_on, description')
          .eq('org_id', caller.orgId).eq('matter_id', matterId).in('id', disbursementIds).order('incurred_on')
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (time.error) throw time.error;
    if (costs.error) throw costs.error;
    if (!(time.data || []).length && !(costs.data || []).length) {
      throw new UserError('Choose the time entries or disbursements the fee note covers first.');
    }

    const reply = await WorkersAiService.write(caller, ai, {
      feature: 'draft.fee_note',
      system: FEE_NOTE_PROMPT,
      user: feeNoteInput(
        { title: String(matter.title || ''), matterNumber: String(matter.matter_number || matter.matterNumber || '') },
        (time.data || []).map((t: any) => ({ date: String(t.entry_date), hours: Number(t.hours) || 0, description: t.description })),
        (costs.data || []).map((d: any) => ({ date: String(d.incurred_on), description: String(d.description || '') })),
      ),
      maxTokens: 450,
    });
    const text = plainProse(reply.text, 2000);
    if (!text) throw new UserError('No narrative came back. Try again.', 502);
    return { text };
  }

  /** The treasurer's remarks for a month's report, compared with the month before. */
  static async treasurerRemarks(caller: AiCaller, month: string, language: DraftLanguage) {
    const ai = await WorkersAiService.assertAvailable(caller);
    const before = previousMonth(month);
    const [org, report, previous] = await Promise.all([
      organizationRow(caller.orgId),
      ChurchReportService.treasurer(caller.orgId, month),
      ChurchReportService.treasurer(caller.orgId, before).catch(() => null),
    ]);
    const reply = await WorkersAiService.write(caller, ai, {
      feature: 'draft.treasurer',
      system: treasurerPrompt(language),
      user: treasurerInput({
        churchName: org.name, monthLabel: monthLabel(month), currency: org.base_currency || 'KES',
        openingCents: report.openingCents, incomeCents: report.incomeCents, expenseCents: report.expenseCents, closingCents: report.closingCents,
        incomeByFund: report.incomeByFund.map((f) => ({ name: f.name, totalCents: f.totalCents })),
        expensesByFund: report.expensesByFund.map((f) => ({ name: f.name, totalCents: f.totalCents })),
        previous: previous ? { monthLabel: monthLabel(before), incomeCents: previous.incomeCents, expenseCents: previous.expenseCents } : null,
        unmatchedCount: report.unmatchedCount, unmatchedCents: report.unmatchedCents, cashNotBankedCents: report.cashNotBankedCents,
      }),
      maxTokens: 450,
    });
    const text = plainProse(reply.text, 2000);
    if (!text) throw new UserError('No remarks came back. Try again.', 502);
    return { text };
  }
}
