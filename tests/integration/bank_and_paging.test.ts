// End-to-end checks of the Worker's services against a local Postgres with
// every migration applied, through PostgREST (the API Supabase serves).
import assert from 'node:assert/strict';
import test from 'node:test';
import { BankingService } from '../../src/server/banking';
import { InvoiceService } from '../../src/server/invoices';
import { BillService } from '../../src/server/bills';
import { LedgerService } from '../../src/server/ledger';
import { AccountService } from '../../src/server/accounts';
import { ReportsService } from '../../src/server/reports';
import { DashboardService } from '../../src/server/metrics';
import { BudgetService } from '../../src/server/budgets';
import { CustomerService } from '../../src/server/customers';
import { PayrollService } from '../../src/server/payroll';
import { OrganizationService } from '../../src/server/organizations';
import { TeamService } from '../../src/server/team';
import { calculatePayslip } from '../../src/utils/kenyaPayroll';
import { ORG, OWNER, MEMBER, BANK, AR, SALES, OPEX, CUSTOMER, VENDOR, sql, uuid, refused } from './helpers';

const B1 = '00000000-0000-0000-0000-0000000000b1'; // IN 500.00 "MPESA INV-2026-00001 ACME"
const B2 = '00000000-0000-0000-0000-0000000000b2'; // OUT 300.00 "KPLC TOKENS"

function addBankLine(id: string, direction: 'IN' | 'OUT', cents: number, description: string, date = '2026-09-20') {
  sql(`INSERT INTO public.bank_transactions (id, org_id, date, description, amount_cents, direction) VALUES ('${id}', '${ORG}', '${date}', '${description}', ${cents}, '${direction}')`);
}

let invoiceId = '';

test('an invoice matched by its number is paid through the invoice, not posted to receivables', async () => {
  invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Cement', accountId: SALES, amountCents: 80_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });

  const matches = await BankingService.getAIMatches(ORG);
  const forB1 = matches.find((m) => m.transactionId === B1)!;
  assert.equal(forB1.matchType, 'INVOICE');
  assert.equal(forB1.entityId, invoiceId);
  assert.equal(forB1.entityName, 'Acme');
  assert.equal(forB1.confidence, 88); // quotes the number, pays part of it

  const journalEntryId = await BankingService.matchTransaction(ORG, B1, { invoiceId }, OWNER);
  const invoice = (await InvoiceService.getInvoices(ORG)).find((i) => i.id === invoiceId)!;
  assert.equal(invoice.status, 'PARTIALLY_PAID');
  assert.equal(invoice.amountDueCents, 30_000);
  assert.equal(invoice.payments[0].journalEntryId, journalEntryId);

  const balances = await AccountService.getAccountBalances(ORG);
  assert.equal(balances.get(AR), 30_000, 'receivables equal what the invoice still owes');
  assert.equal(balances.get(BANK), 50_000);

  await refused(BankingService.matchTransaction(ORG, B1, { invoiceId }, OWNER), /already matched/);
});

test('a payment already recorded on the Sales page is linked, not posted a second time', async () => {
  const payment = await InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 30_000, paymentDate: '2026-09-19', depositAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER,
  });
  const B3 = uuid();
  const B4 = uuid();
  addBankLine(B3, 'IN', 30_000, 'TRANSFER FROM ACME');

  const forB3 = (await BankingService.getAIMatches(ORG)).find((m) => m.transactionId === B3)!;
  assert.equal(forB3.matchType, 'ENTRY');
  assert.equal(forB3.journalEntryId, payment.journalEntryId);
  assert.ok(forB3.confidence >= 85);

  await BankingService.matchTransaction(ORG, B3, { existingJournalEntryId: payment.journalEntryId }, OWNER);
  assert.equal((await AccountService.getAccountBalances(ORG)).get(BANK), 80_000, 'the bank moved once for the payment');

  addBankLine(B4, 'IN', 30_000, 'SECOND LINE');
  await refused(
    BankingService.matchTransaction(ORG, B4, { existingJournalEntryId: payment.journalEntryId }, OWNER), /already matched to another statement line/);
  // An entry that moved the bank by a different amount cannot stand for this line.
  const other = await LedgerService.postJournalEntry({
    orgId: ORG, entryDate: '2026-09-20', memo: 'Cash sale', sourceType: 'MANUAL', createdBy: OWNER,
    lines: [{ accountId: BANK, debit: 12_000, credit: 0 }, { accountId: SALES, debit: 0, credit: 12_000 }],
  });
  await refused(
    BankingService.matchTransaction(ORG, B4, { existingJournalEntryId: other }, OWNER), /different amount/);
});

test('receivables, payables and the bank itself cannot be posted to from a bank line', async () => {
  const B5 = uuid();
  addBankLine(B5, 'IN', 7_000, 'UNKNOWN DEPOSIT');
  await refused(BankingService.matchTransaction(ORG, B5, { targetAccountId: AR }, OWNER), /Accounts receivable \(1100\)/);
  await refused(BankingService.matchTransaction(ORG, B5, { targetAccountId: BANK }, OWNER), /bank account itself/);
  await refused(BankingService.matchTransaction(ORG, B5, {}, OWNER), /exactly one/);
  await refused(
    LedgerService.postJournalEntry({
      orgId: ORG, entryDate: '2026-09-20', memo: 'Sneaky', sourceType: 'MANUAL', createdBy: OWNER,
      lines: [{ accountId: AR, debit: 1_000, credit: 0 }, { accountId: SALES, debit: 0, credit: 1_000 }],
    }), /Accounts receivable \(1100\)/);
  await refused(BankingService.createRule(ORG, 'ACME', AR, OWNER), /cannot post to accounts receivable/);

  await BankingService.matchTransaction(ORG, B5, { targetAccountId: SALES }, OWNER);
});

test('a bill matched from money out is paid through the bill', async () => {
  const billId = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-05', dueDate: '2026-10-05', currency: 'KES',
    lines: [{ description: 'Power', accountId: OPEX, amountCents: 30_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  const forB2 = (await BankingService.getAIMatches(ORG)).find((m) => m.transactionId === B2)!;
  assert.equal(forB2.matchType, 'BILL');
  assert.equal(forB2.entityId, billId);
  assert.equal(forB2.confidence, 80); // only open bill owing exactly this; no number quoted

  // 80 is below the auto-accept threshold, and a lower threshold from the client is ignored.
  const auto = await BankingService.autoReconcileAll(ORG, 10, OWNER);
  assert.equal(auto.count, 0);

  await BankingService.matchTransaction(ORG, B2, { billId }, OWNER);
  const bill = (await BillService.getBills(ORG)).find((b) => b.id === billId)!;
  assert.equal(bill.status, 'PAID');
});

test('auto-accept takes strong matches in bounded batches', async () => {
  // Seven entries already posted to the bank, each with a statement line a day later.
  for (let i = 0; i < 7; i++) {
    const cents = 1_000 + i;
    await LedgerService.postJournalEntry({
      orgId: ORG, entryDate: '2026-09-10', memo: `Takings ${i}`, sourceType: 'MANUAL', createdBy: OWNER,
      lines: [{ accountId: BANK, debit: cents, credit: 0 }, { accountId: SALES, debit: 0, credit: cents }],
    });
    addBankLine(uuid(), 'IN', cents, `TAKINGS ${i}`, '2026-09-11');
  }
  const first = await BankingService.autoReconcileAll(ORG, 85, OWNER);
  assert.equal(first.count, 5);
  assert.equal(first.remaining, 2);
  const second = await BankingService.autoReconcileAll(ORG, 85, OWNER);
  assert.equal(second.count, 2);
  assert.equal(second.remaining, 0);
});

test('lists, balances and the ledger export do not stop at 1,000 rows', async () => {
  sql(`INSERT INTO public.customers (org_id, display_name) SELECT '${ORG}', 'Customer ' || g FROM generate_series(1, 1200) g`);
  sql(`INSERT INTO public.bank_transactions (org_id, date, description, amount_cents, direction) SELECT '${ORG}', DATE '2026-01-01' + (g % 200), 'BULK ' || g, 100, 'OUT' FROM generate_series(1, 1500) g`);
  sql(`DO \\$\\$ BEGIN FOR i IN 1..1100 LOOP PERFORM public.post_journal_entry('${ORG}', DATE '2026-03-01' + (i % 100), 'bulk', 'MANUAL', NULL, NULL, '${OWNER}', jsonb_build_array(jsonb_build_object('accountId', '${OPEX}', 'debit', 100, 'credit', 0), jsonb_build_object('accountId', '${BANK}', 'debit', 0, 'credit', 100)), NULL); END LOOP; END \\$\\$`);

  assert.equal((await CustomerService.getCustomers(ORG)).length, 1201);
  const transactions = await BankingService.getTransactions(ORG);
  assert.ok(transactions.length >= 1500 + 6);
  const entries = await LedgerService.getJournalEntries(ORG);
  const entryCount = Number(sql(`SELECT count(*) FROM public.journal_entries WHERE org_id = '${ORG}'`));
  assert.equal(entries.length, entryCount);
  assert.ok(entryCount > 1100);

  const dbBank = Number(sql(`SELECT sum(l.debit) - sum(l.credit) FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id WHERE e.org_id = '${ORG}' AND l.account_id = '${BANK}'`));
  assert.equal((await AccountService.getAccountBalances(ORG)).get(BANK), dbBank);
  const accounts = await AccountService.getAccounts(ORG);
  assert.equal(accounts.find((a) => a.id === BANK)!.balanceCents, dbBank);
});

test('reports and the dashboard agree with the ledger', async () => {
  const tb = await ReportsService.getTrialBalance(ORG);
  const debits = tb.rows.reduce((s, r) => s + r.debitCents, 0);
  const credits = tb.rows.reduce((s, r) => s + r.creditCents, 0);
  assert.equal(debits, credits, 'trial balance balances');

  const bs = await ReportsService.getBalanceSheet(ORG, '2026-12-31');
  const sum = (rows: { amountCents: number }[]) => rows.reduce((s, r) => s + r.amountCents, 0);
  assert.equal(sum(bs.currentAssets) + sum(bs.nonCurrentAssets), sum(bs.currentLiabilities) + sum(bs.equity), 'assets = liabilities + equity');

  const pl = await ReportsService.getProfitAndLoss(ORG, 'This year-to-date');
  assert.ok(Array.isArray(pl.income));

  const metrics = await DashboardService.getMetrics(ORG);
  const dbBank = Number(sql(`SELECT sum(l.debit) - sum(l.credit) FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id WHERE e.org_id = '${ORG}' AND l.account_id = '${BANK}'`));
  assert.equal(metrics.cashPositionCents, dbBank);
  assert.equal(metrics.moneyInCents, 0, 'the invoice is fully paid');
  assert.equal(metrics.moneyOutCents, 0, 'the bill is paid');
});

test('a budget measures spending in its own period', async () => {
  sql(`INSERT INTO public.budgets (org_id, account_id, period, limit_cents) VALUES ('${ORG}', '${OPEX}', 'MONTHLY', 500000)`);
  const thisMonth = new Date().toISOString().slice(0, 10);
  await LedgerService.postJournalEntry({
    orgId: ORG, entryDate: thisMonth, memo: 'This month', sourceType: 'MANUAL', createdBy: OWNER,
    lines: [{ accountId: OPEX, debit: 4_200, credit: 0 }, { accountId: BANK, debit: 0, credit: 4_200 }],
  });
  const [budget] = await BudgetService.getBudgets(ORG);
  assert.equal(budget.spentCents, 4_200, 'only this month, not the 1,100 older expense entries');
});


test('payroll taxes allowances, reads rates for the month earned, and refuses a second run of the same month', async () => {
  const employeeId = await PayrollService.addEmployee(ORG, {
    firstName: 'Wanjiru', lastName: 'Kamau', baseSalaryCents: 5_000_000,
    housingAllowanceCents: 1_000_000, transportAllowanceCents: 500_000, nationalId: '12345678', mpesaNumber: '254700000000',
  });
  const [employee] = (await PayrollService.getEmployees(ORG)).filter((e) => e.id === employeeId);
  assert.equal(employee.grossPayCents, 6_500_000);
  assert.equal(employee.nationalId, '12345678');

  await refused(PayrollService.addEmployee(ORG, { firstName: 'A', lastName: 'B', housingAllowanceCents: -5 }), /non-negative/);

  // January 2026 paid on 2 February: January's rates (NSSF Year 3), on 65,000 gross.
  const runId = await PayrollService.runPayroll(ORG, 'jan 2026', '2026-02-02', OWNER);
  const [slip] = await PayrollService.getPayslips(ORG, runId);
  const expected = calculatePayslip(6_500_000, '2026-01-31');
  assert.equal(slip.grossCents, 6_500_000);
  assert.equal(slip.rateVersion, 'KE-2025-02');
  assert.equal(slip.payeCents, expected.payeCents);
  assert.equal(slip.nssfCents, expected.nssfCents);
  const [run] = await PayrollService.getPayrollRuns(ORG);
  assert.equal(run.period, 'January 2026');

  await refused(PayrollService.runPayroll(ORG, 'January 2026', '2026-02-03', OWNER), /already been run/);
  await refused(PayrollService.runPayroll(ORG, 'Week 5', '2026-02-03', OWNER), /month and year/);
});

test('the base currency is fixed once entries are posted', async () => {
  await refused(OrganizationService.updateOrganization(ORG, { baseCurrency: 'USD' }), /cannot change after entries are posted/);
  await refused(OrganizationService.updateOrganization(ORG, { baseCurrency: 'shillings' }), /three-letter/);
  await OrganizationService.updateOrganization(ORG, { baseCurrency: 'kes', name: 'Test Co Ltd' });
});

test('team members are listed in one query, and joining needs the invitee to accept', async () => {
  sql(`UPDATE auth.users SET email = 'owner@example.com' WHERE id = '${OWNER}'`);
  sql(`UPDATE auth.users SET email = 'member@example.com' WHERE id = '${MEMBER}'`);
  const team = await TeamService.getTeam(ORG, OWNER);
  assert.deepEqual(team.members.map((m) => [m.email, m.role, m.isYou]), [['owner@example.com', 'owner', true]]);
  assert.deepEqual(team.invitations, []);
  await refused(TeamService.invite(ORG, 'OWNER@example.com', 'member', OWNER), /already a member/);
  await refused(TeamService.invite(ORG, 'not-an-address', 'member', OWNER), /valid email/);

  const invitation = await TeamService.invite(ORG, 'Member@Example.com', 'accountant', OWNER);
  assert.equal(invitation.emailed, false, 'an existing account is not sent a sign-up email');
  assert.equal((await TeamService.getTeam(ORG, OWNER)).invitations.length, 1);
  assert.equal((await TeamService.getTeam(ORG, OWNER)).members.length, 1, 'not a member until they accept');

  const [pending] = await TeamService.myInvitations(MEMBER);
  assert.equal(pending.id, invitation.invitationId);
  await TeamService.respond(invitation.invitationId, MEMBER, true);
  const after = await TeamService.getTeam(ORG, OWNER);
  assert.equal(after.members.find((m) => m.role === 'accountant')?.email, 'member@example.com');
  assert.deepEqual(after.invitations, []);
  await assert.rejects(TeamService.respond(invitation.invitationId, MEMBER, true));
});
