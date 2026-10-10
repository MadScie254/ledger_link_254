import { getSupabase } from './supabase';
import { UserError } from './errors';
import { organizationToday } from './organizationDates';
import { ReportsService } from './reports';
import { BusinessReportService } from './businessReports';
import { AccountService } from './accounts';
import { MatterService } from './matters';
import { ClientAccountService } from './clientAccount';
import { ChurchReportService } from './churchReports';
import { WorkersAiService, type AiCaller } from './workersAi';
import { AI_MODELS, plainProse, redactPersonal } from '../utils/workersAi';
import {
  QUESTIONS, answerInput, answerPrompt, monthLabel, parsePlan, planPrompt, previousMonth, questionsFor, topicName,
  type AskEdition, type Plan, type QuestionResult,
} from '../utils/aiQuestions';

/**
 * The Ask box (Business feed): a question is routed by the model to one
 * fixed question, the Worker answers that question from the books for the
 * organization the person is signed in to, and the model explains the rows.
 */

export interface AskAnswer {
  answer: string;
  /** The question run, or null when none fitted. */
  question: string | null;
  title?: string;
  scope?: string;
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
}

const amount = (cents: number) => (cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + (pick(row) || 0), 0);
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function organization(orgId: string): Promise<{ edition: AskEdition; currency: string }> {
  const { data, error } = await getSupabase().from('organizations').select('edition, base_currency').eq('id', orgId).maybeSingle();
  if (error) throw error;
  if (!data) throw new UserError('Organization not found.', 404);
  const edition = data.edition === 'law' || data.edition === 'church' ? data.edition : 'business';
  return { edition, currency: data.base_currency || 'KES' };
}

/** Parties from an aging report, one row each: owed, overdue and the oldest days late. */
function byParty(rows: Array<{ partyName: string; amountDueCents: number; daysPastDue: number }>) {
  const parties = new Map<string, { owed: number; overdue: number; oldest: number; documents: number }>();
  for (const row of rows) {
    const party = parties.get(row.partyName) || { owed: 0, overdue: 0, oldest: 0, documents: 0 };
    party.owed += row.amountDueCents;
    if (row.daysPastDue > 0 && row.amountDueCents > 0) {
      party.overdue += row.amountDueCents;
      party.oldest = Math.max(party.oldest, row.daysPastDue);
    }
    if (row.amountDueCents > 0) party.documents += 1;
    parties.set(row.partyName, party);
  }
  return [...parties.entries()].filter(([, p]) => p.owed !== 0).sort((a, b) => b[1].owed - a[1].owed);
}

/** Runs one planned question for an organization. Every query is scoped to orgId. */
async function runQuestion(orgId: string, plan: Plan, today: string, currency: string): Promise<QuestionResult> {
  const { args } = plan;
  const title = QUESTIONS[plan.question].title;
  const limit = args.limit ?? 10;
  const c = `(${currency})`;

  switch (plan.question) {
    case 'profit_and_loss': {
      const p = args.period!;
      const pnl = await ReportsService.getProfitAndLoss(orgId, p.range);
      const income = sum(pnl.income, (r) => r.amountCents);
      const cogs = sum(pnl.costOfSales, (r) => r.amountCents);
      const expenses = sum(pnl.expenses, (r) => r.amountCents);
      const section = (label: string, rows: typeof pnl.income) => [...rows].sort((a, b) => b.amountCents - a.amountCents).map((r) => [r.name, label, amount(r.amountCents)]);
      return {
        title, scope: p.label, columns: ['Account', 'Section', `Amount ${c}`],
        rows: [...section('Income', pnl.income), ...section('Cost of sales', pnl.costOfSales), ...section('Expenses', pnl.expenses)],
        facts: [
          `Income: ${currency} ${amount(income)}`,
          `Cost of sales: ${currency} ${amount(cogs)}`,
          `Gross profit: ${currency} ${amount(income - cogs)}`,
          `Expenses: ${currency} ${amount(expenses)}`,
          `${income - cogs - expenses >= 0 ? 'Net profit' : 'Net loss'}: ${currency} ${amount(Math.abs(income - cogs - expenses))}`,
        ],
      };
    }
    case 'compare_months': {
      const month = args.month!;
      const before = previousMonth(month);
      const [now, then] = await Promise.all([
        ReportsService.getProfitAndLoss(orgId, month),
        ReportsService.getProfitAndLoss(orgId, before),
      ]);
      const totals = (pnl: typeof now) => {
        const income = sum(pnl.income, (r) => r.amountCents);
        const spend = sum(pnl.costOfSales, (r) => r.amountCents) + sum(pnl.expenses, (r) => r.amountCents);
        return { income, spend, net: income - spend };
      };
      const a = totals(then);
      const b = totals(now);
      const lines = new Map<string, { name: string; before: number; after: number }>();
      const add = (pnl: typeof now, key: 'before' | 'after') => {
        for (const row of [...pnl.income, ...pnl.costOfSales, ...pnl.expenses]) {
          const id = `${(row as { code?: string }).code ?? ''}\u0000${row.name}`;
          const line = lines.get(id) || { name: row.name, before: 0, after: 0 };
          line[key] += row.amountCents;
          lines.set(id, line);
        }
      };
      add(then, 'before');
      add(now, 'after');
      const changed = [...lines.values()].filter((l) => l.after !== l.before)
        .sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before)).slice(0, 12);
      return {
        title, scope: `${monthLabel(month)} against ${monthLabel(before)}`,
        columns: ['Account', `${monthLabel(before)} ${c}`, `${monthLabel(month)} ${c}`, `Change ${c}`],
        rows: changed.map((l) => [l.name, amount(l.before), amount(l.after), `${l.after - l.before >= 0 ? '+' : '-'}${amount(Math.abs(l.after - l.before))}`]),
        facts: [
          `${monthLabel(before)}: income ${currency} ${amount(a.income)}, spending ${currency} ${amount(a.spend)}, ${a.net >= 0 ? 'profit' : 'loss'} ${currency} ${amount(Math.abs(a.net))}`,
          `${monthLabel(month)}${month === today.slice(0, 7) ? ' (so far)' : ''}: income ${currency} ${amount(b.income)}, spending ${currency} ${amount(b.spend)}, ${b.net >= 0 ? 'profit' : 'loss'} ${currency} ${amount(Math.abs(b.net))}`,
        ],
      };
    }
    case 'expenses_by_account': {
      const p = args.period!;
      const pnl = await ReportsService.getProfitAndLoss(orgId, p.range);
      const rows = [...pnl.costOfSales, ...pnl.expenses].filter((r) => r.amountCents > 0).sort((a, b) => b.amountCents - a.amountCents);
      const total = sum(rows, (r) => r.amountCents);
      return {
        title, scope: p.label, columns: ['Account', `Spent ${c}`, 'Share'],
        rows: rows.slice(0, limit).map((r) => [r.name, amount(r.amountCents), total ? `${Math.round((r.amountCents / total) * 100)}%` : '']),
        facts: [`Total spending: ${currency} ${amount(total)} across ${rows.length} accounts`],
      };
    }
    case 'cash_position': {
      const accounts = (await AccountService.getAccounts(orgId)).filter((a) => a.isBankAccount && a.isActive !== false);
      return {
        title, scope: `today, ${longDate(today)}`, columns: ['Account', `Balance ${c}`],
        rows: accounts.map((a) => [`${a.code} ${a.name}`, amount(a.balanceCents)]),
        facts: [`Total in money accounts: ${currency} ${amount(sum(accounts, (a) => a.balanceCents))}`],
      };
    }
    case 'who_owes_us':
    case 'what_we_owe': {
      const aging = plan.question === 'who_owes_us' ? await ReportsService.getARAging(orgId) : await ReportsService.getAPAging(orgId);
      const parties = byParty(aging.rows as any[]);
      const word = plan.question === 'who_owes_us' ? 'Customer' : 'Supplier';
      return {
        title, scope: `today, ${longDate(today)}`, columns: [word, `Owed ${c}`, `Overdue ${c}`, 'Oldest, days late'],
        rows: parties.slice(0, limit).map(([name, p]) => [name, amount(p.owed), amount(p.overdue), p.oldest || '']),
        facts: [
          `Total owed: ${currency} ${amount(aging.grandTotalCents)}`,
          `Overdue: ${currency} ${amount(sum(parties, ([, p]) => p.overdue))}`,
          `${parties.length} ${plan.question === 'who_owes_us' ? 'customers' : 'suppliers'} with a balance`,
        ],
      };
    }
    case 'overdue_invoices': {
      const minDays = Math.max(args.min_days ?? 1, 1);
      const aging = await ReportsService.getARAging(orgId);
      const late = (aging.rows as any[]).filter((r) => r.amountDueCents > 0 && r.daysPastDue >= minDays).sort((a, b) => b.daysPastDue - a.daysPastDue);
      return {
        title, scope: `${minDays > 1 ? `at least ${minDays} days late, ` : ''}today, ${longDate(today)}`,
        columns: ['Invoice', 'Customer', 'Due', 'Days late', `Owed ${c}`],
        rows: late.slice(0, limit).map((r) => [r.referenceNo, r.partyName, r.dueDate, r.daysPastDue, amount(r.amountDueCents)]),
        facts: [`${late.length} overdue invoices, ${currency} ${amount(sum(late, (r) => r.amountDueCents))} in all`],
      };
    }
    case 'top_customers': {
      const p = args.period!;
      const report = await BusinessReportService.salesByCustomer(orgId, p.range);
      const rows = [...report.rows].sort((a, b) => b.netCents - a.netCents);
      return {
        title, scope: p.label, columns: ['Customer', `Sales ${c}`, 'Documents'],
        rows: rows.slice(0, limit).map((r) => [r.name || 'Cash sales', amount(r.netCents), r.documents]),
        facts: [`Total sales: ${currency} ${amount(report.totalCents)} from ${rows.length} customers`],
      };
    }
    case 'top_items': {
      const p = args.period!;
      const report = await BusinessReportService.salesByItem(orgId, p.range);
      const rows = [...report.rows].sort((a, b) => b.amountCents - a.amountCents);
      return {
        title, scope: p.label, columns: ['Item', 'Quantity', `Sales ${c}`],
        rows: rows.slice(0, limit).map((r) => [r.name || 'Not a stock item', r.quantity, amount(r.amountCents)]),
        facts: [`Total item sales: ${currency} ${amount(report.totalCents)}`],
      };
    }
    case 'top_suppliers': {
      const p = args.period!;
      const report = await BusinessReportService.expensesBySupplier(orgId, p.range);
      const rows = [...report.rows].sort((a, b) => b.netCents - a.netCents);
      return {
        title, scope: p.label, columns: ['Supplier', `Spent ${c}`, 'Documents'],
        rows: rows.slice(0, limit).map((r) => [r.name || 'No supplier named', amount(r.netCents), r.documents]),
        facts: [`Total bought: ${currency} ${amount(report.totalCents)} from ${rows.length} suppliers`],
      };
    }
    case 'vat_position': {
      const p = args.period!;
      const vat = await ReportsService.getTaxSummary(orgId, p.range);
      return {
        title, scope: p.label, columns: ['Line', `Amount ${c}`],
        rows: [
          ['Sales at 16%', amount(vat.outputVat.standardRatedSalesCents)],
          ['Output VAT on sales', amount(vat.outputVat.taxAmountCents)],
          ['Purchases with claimable VAT', amount(vat.inputVat.claimablePurchasesCents)],
          ['Input VAT on purchases', amount(vat.inputVat.taxAmountCents)],
          [vat.netVatPayableCents >= 0 ? 'VAT payable to KRA' : 'VAT to carry forward', amount(Math.abs(vat.netVatPayableCents))],
        ],
        facts: [`${vat.netVatPayableCents >= 0 ? 'VAT payable' : 'VAT credit'}: ${currency} ${amount(Math.abs(vat.netVatPayableCents))}`, 'VAT returns are due by the 20th of the following month'],
      };
    }
    case 'work_in_progress': {
      const wip = await MatterService.workInProgress(orgId);
      const ids = wip.matters.map((m) => m.matterId);
      const { data, error } = ids.length
        ? await getSupabase().from('matters').select('id, matter_number, title').eq('org_id', orgId).in('id', ids.slice(0, 200))
        : { data: [], error: null };
      if (error) throw error;
      const names = new Map((data || []).map((m: any) => [m.id, `${m.matter_number} ${m.title}`]));
      const rows = [...wip.matters].sort((a, b) => (b.timeCents + b.disbursementCents) - (a.timeCents + a.disbursementCents));
      return {
        title, scope: `today, ${longDate(today)}`, columns: ['Matter', `Time ${c}`, `Disbursements ${c}`, `Total ${c}`],
        rows: rows.slice(0, limit).map((m) => [names.get(m.matterId) || 'Matter', amount(m.timeCents), amount(m.disbursementCents), amount(m.timeCents + m.disbursementCents)]),
        facts: [`Unbilled time: ${currency} ${amount(wip.timeCents)}`, `Unbilled disbursements: ${currency} ${amount(wip.disbursementCents)}`, `${rows.length} matters with unbilled work`],
      };
    }
    case 'client_money': {
      const p = await ClientAccountService.position(orgId, today);
      const agrees = p.clientBankCents === p.clientHeldCents && p.clientHeldCents === p.matterLedgersCents;
      return {
        title, scope: `today, ${longDate(today)}`, columns: ['Line', `Amount ${c}`],
        rows: [
          ['Client bank account', amount(p.clientBankCents)],
          ['Client money held', amount(p.clientHeldCents)],
          ['Matter client ledgers', amount(p.matterLedgersCents)],
          ['Held but not on a matter', amount(p.untaggedHeldCents)],
        ],
        facts: [agrees ? 'The client bank account, client money held and the matter ledgers agree' : 'The client bank account, client money held and the matter ledgers do not agree'],
      };
    }
    case 'fund_balances': {
      const p = args.period!;
      const report = await ChurchReportService.fundBalances(orgId, p.from, p.to);
      return {
        title, scope: p.label, columns: ['Fund', `Opening ${c}`, `Income ${c}`, `Expenses ${c}`, `Closing ${c}`],
        rows: report.funds.map((f) => [f.restricted ? `${f.name} (restricted)` : f.name, amount(f.openingCents), amount(f.incomeCents), amount(f.expenseCents), amount(f.closingCents)]),
        facts: [`Income: ${currency} ${amount(sum(report.funds, (f) => f.incomeCents))}`, `Expenses: ${currency} ${amount(sum(report.funds, (f) => f.expenseCents))}`, `Closing, all funds: ${currency} ${amount(sum(report.funds, (f) => f.closingCents))}`],
      };
    }
    case 'giving_by_fund': {
      const month = args.month!;
      const report = await ChurchReportService.treasurer(orgId, month);
      return {
        title, scope: monthLabel(month), columns: ['Fund', 'Account', `Received ${c}`],
        rows: report.incomeByFund.flatMap((f) => f.accounts.map((a) => [f.name, a.name, amount(a.amountCents)])),
        facts: [
          `Income: ${currency} ${amount(report.incomeCents)}`,
          `M-Pesa receipts waiting to be matched: ${report.unmatchedCount} (${currency} ${amount(report.unmatchedCents)})`,
          `Counted cash not yet banked: ${currency} ${amount(report.cashNotBankedCents)}`,
        ],
      };
    }
  }
}

export class AskService {
  static async ask(caller: AiCaller, question: string): Promise<AskAnswer> {
    const ai = await WorkersAiService.assertAvailable(caller);
    const [{ edition, currency }, today] = await Promise.all([organization(caller.orgId), organizationToday(caller.orgId)]);
    const asked = redactPersonal(question.trim()).slice(0, 500);

    const planned = await WorkersAiService.run(caller, ai, {
      feature: 'ask.plan',
      model: AI_MODELS.text,
      input: { messages: [{ role: 'system', content: planPrompt(edition, today) }, { role: 'user', content: asked }], max_tokens: 120, temperature: 0 },
    });
    const plan = parsePlan(planned.json, edition, today);
    if (!plan) {
      const topics = questionsFor(edition).map(topicName).join('; ');
      return { answer: `That is not a question the books can answer yet. Questions can be about: ${topics}.`, question: null };
    }

    const result = await runQuestion(caller.orgId, plan, today, currency);
    const explained = await WorkersAiService.write(caller, ai, {
      feature: 'ask.answer', system: answerPrompt(plan.language), user: answerInput(asked, result), maxTokens: 300, temperature: 0.2,
    });
    return {
      answer: plainProse(explained.text, 900) || 'The figures are below.',
      question: plan.question,
      title: result.title,
      scope: result.scope,
      columns: result.columns,
      rows: result.rows,
    };
  }

  /** A spoken question as text, for the person to check before asking it. */
  static async transcribe(caller: AiCaller, audioBase64: string): Promise<string> {
    const ai = await WorkersAiService.assertAvailable(caller);
    const reply = await WorkersAiService.run(caller, ai, {
      feature: 'ask.voice',
      model: AI_MODELS.speech,
      input: { audio: audioBase64 },
    });
    const text = plainProse(reply.text, 500);
    if (!text) throw new UserError('Nothing could be heard in the recording. Try again closer to the microphone.');
    return text;
  }
}
