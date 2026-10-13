import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { LedgerService } from '../../src/server/ledger';
import { YearEndService } from '../../src/server/yearEnd';
import { ReportsService } from '../../src/server/reports';
import { BusinessReportService } from '../../src/server/businessReports';
import { getSupabase } from '../../src/server/supabase';
import { registerOrganizationRoutes } from '../../worker/routes/organizations';
import { BANK, OPEX, ORG, OWNER, SALES, MEMBER, refused } from './helpers';

test('closing transfers annual result to retained earnings while reports keep the year activity', async () => {
  const db = getSupabase();
  const changed = await db.from('organizations').update({ fiscal_year_start: 'October' }).eq('id', ORG);
  assert.equal(changed.error, null);
  await LedgerService.postJournalEntry({ orgId: ORG, entryDate: '2026-09-15', sourceType: 'MANUAL', createdBy: OWNER,
    lines: [{ accountId: BANK, debit: 10_000, credit: 0 }, { accountId: SALES, debit: 0, credit: 10_000 }] });
  await LedgerService.postJournalEntry({ orgId: ORG, entryDate: '2026-09-16', sourceType: 'MANUAL', createdBy: OWNER,
    lines: [{ accountId: OPEX, debit: 4_000, credit: 0 }, { accountId: BANK, debit: 0, credit: 4_000 }] });
  await refused(YearEndService.close(ORG, '2026-09-29', OWNER), /last day/i);
  await refused(YearEndService.close(ORG, '2026-09-30', MEMBER), /owner or admin/i);
  const close = await YearEndService.close(ORG, '2026-09-30', OWNER);
  assert.equal((await YearEndService.list(ORG))[0].id, close.id);
  const pnl = await ReportsService.getProfitAndLoss(ORG, 'September 2026');
  assert.equal(pnl.income.find((row) => row.name === 'Sales')?.amountCents, 10_000);
  assert.equal(pnl.expenses.find((row) => row.name === 'Operating expenses')?.amountCents, 4_000);
  const monthly = await BusinessReportService.monthlyProfitAndLoss(ORG, 'September 2026');
  assert.equal(monthly.netTotalCents, 6_000);
  const balance = await ReportsService.getBalanceSheet(ORG, '2026-09-30');
  assert.equal(balance.equity.find((row) => row.name === 'Retained Earnings')?.amountCents, 6_000);
  const cashFlow = await ReportsService.getCashFlow(ORG, 'September 2026');
  assert.equal(cashFlow.operating.find((row) => row.name === 'Net income')?.amountCents, 6_000);
  await refused(YearEndService.close(ORG, '2026-09-30', OWNER), /previous financial year|closed/i);
  const reopened = await YearEndService.reopen(ORG, close.id, 'Adjust the year', OWNER);
  assert.ok(reopened.reversalJournalEntryId);
  assert.deepEqual(await YearEndService.reopen(ORG, close.id, 'Retry', OWNER), reopened);
  const after = await ReportsService.getBalanceSheet(ORG, '2026-09-30');
  assert.equal(after.equity.find((row) => row.name === 'Retained Earnings'), undefined);
  assert.equal((await ReportsService.getProfitAndLoss(ORG, 'September 2026')).income[0].amountCents, 10_000);
});

test('year-end routes require the organization and an owner or admin for changes', async () => {
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', ORG); c.set('userId', OWNER); c.set('orgRole', c.req.header('x-test-role')); await next(); });
  registerOrganizationRoutes(api);
  const denied = await api.request(`/organizations/${ORG}/year-end`, {
    method: 'POST', headers: { 'x-test-role': 'member', 'content-type': 'application/json' },
    body: JSON.stringify({ yearEnd: '2026-09-30' }),
  });
  assert.equal(denied.status, 403);
});
