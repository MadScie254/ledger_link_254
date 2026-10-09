// The demo seed scripts (scripts/seed-demo-law.ts, scripts/seed-demo-church.ts)
// run against PostgREST like the app does: both tenants are marked as demo
// books, carry no contact details, and their ledgers balance.
import assert from 'node:assert/strict';
import test from 'node:test';
import { seedLawDemo, LAW_DEMO_NAME } from '../../scripts/demo/lawDemo';
import { seedChurchDemo, CHURCH_DEMO_NAME } from '../../scripts/demo/churchDemo';
import { ChurchReportService } from '../../src/server/churchReports';
import { OWNER, MEMBER, sql } from './helpers';

const unbalanced = (orgId: string) => Number(sql(`SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = '${orgId}'`));

test('the law demo is a marked demo firm with five matters across litigation and conveyancing', async () => {
  const { orgId, matters } = await seedLawDemo(OWNER, new Date('2026-10-08T09:00:00Z'));
  assert.equal(matters, 5);
  assert.equal(sql(`SELECT name || ':' || edition || ':' || is_demo FROM public.organizations WHERE id = '${orgId}'`), `${LAW_DEMO_NAME}:law:true`);
  assert.equal(sql(`SELECT string_agg(matter_type || '=' || n, ',' ORDER BY matter_type) FROM (SELECT matter_type, count(*) n FROM public.matters WHERE org_id = '${orgId}' GROUP BY 1) t`),
    'CONVEYANCING=2,LITIGATION=3');
  assert.equal(sql(`SELECT count(*) FROM public.customers WHERE org_id = '${orgId}' AND (phone IS NOT NULL OR email IS NOT NULL OR kra_pin IS NOT NULL)`), '0', 'no contact or ID details');
  assert.equal(unbalanced(orgId), 0);
  // Client money in the bank equals what is held for clients.
  const client = (code: string) => Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${orgId}' AND a.code = '${code}'`));
  assert.equal(client('1060'), -client('2200'));
  assert.ok(client('1060') > 0);
});

test('the church demo has 60 members, four funds and three months of giving that reconcile', async () => {
  const result = await seedChurchDemo(OWNER, { secondUserId: MEMBER, today: '2026-10-08' });
  const { orgId } = result;
  assert.equal(result.members, 60);
  assert.equal(result.sundays, 13);
  assert.ok(result.mpesaPosted > 200, 'most M-Pesa gifts are placed by the rules');
  assert.ok(result.mpesaQueued >= 3, 'references the rules cannot place wait in the queue');
  assert.equal(sql(`SELECT name || ':' || edition || ':' || is_demo FROM public.organizations WHERE id = '${orgId}'`), `${CHURCH_DEMO_NAME}:church:true`);
  assert.equal(sql(`SELECT count(*) FROM public.members WHERE org_id = '${orgId}'`), '60');
  assert.equal(sql(`SELECT count(*) FROM public.members WHERE org_id = '${orgId}' AND (phone IS NOT NULL OR email IS NOT NULL)`), '0', 'no contact details');
  assert.equal(sql(`SELECT string_agg(code, ',' ORDER BY code) FROM public.funds WHERE org_id = '${orgId}'`), 'BUILDING,GENERAL,MISSIONS,WELFARE');
  assert.equal(sql(`SELECT count(*) FROM public.collections WHERE org_id = '${orgId}' AND status = 'BANKED'`), '13', 'every Sunday counted twice and banked');
  assert.equal(sql(`SELECT min(received_on) <= '2026-07-13' AND max(received_on) >= '2026-10-04' FROM public.contributions WHERE org_id = '${orgId}'`), 't', 'three months of giving');
  assert.equal(unbalanced(orgId), 0);
  const balances = await ChurchReportService.fundBalances(orgId, '2026-07-01', '2026-10-31');
  assert.equal(balances.reconciliation.reconciles, true, 'fund balances reconcile to the trial balance');
  assert.ok(balances.funds.find((fund) => fund.code === 'BUILDING')!.incomeCents > 0);
  assert.ok(balances.funds.find((fund) => fund.code === 'WELFARE')!.expenseCents > 0);
  const report = await ChurchReportService.treasurer(orgId, '2026-09');
  assert.ok(report.incomeCents > 0 && report.unmatchedCount === result.mpesaQueued);
});
