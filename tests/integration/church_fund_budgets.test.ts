import assert from 'node:assert/strict';
import test from 'node:test';
import { OrganizationService } from '../../src/server/organizations';
import { FundsService } from '../../src/server/funds';
import { FundBudgetService } from '../../src/server/fundBudgets';
import { ORG, OWNER, MEMBER, sql, refused } from './helpers';

test('a church owner sets a fund budget and reads actual fund amounts', async () => {
  const church = await OrganizationService.createOrganization({ name: 'Budget church', country: 'Kenya', edition: 'church' } as any, OWNER);
  const general = (await FundsService.list(church)).find((fund) => fund.code === 'GENERAL')!;
  sql(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${church}', '${MEMBER}', 'member')`);
  await FundBudgetService.save(church, OWNER, general.id, 2026, { incomeTargetCents: 12000000, expenseLimitCents: 8500000 });
  const result = await FundBudgetService.list(church, 2026);
  const row = result.funds.find((fund) => fund.fundId === general.id)!;
  assert.equal(row.incomeTargetCents, 12000000);
  assert.equal(row.expenseLimitCents, 8500000);
  assert.equal(row.incomeCents, 0);
  assert.equal(row.expenseCents, 0);
  const asOf = await FundBudgetService.list(church, 2026, '2026-03-31');
  assert.equal(asOf.asOf, '2026-03-31');
  await refused(FundBudgetService.list(church, 2026, '2027-01-01'), /within this financial year/);
  await refused(FundBudgetService.save(church, MEMBER, general.id, 2026, { incomeTargetCents: 1, expenseLimitCents: 1 }), /owner or admin/);
  await refused(FundBudgetService.save(ORG, OWNER, general.id, 2026, { incomeTargetCents: 1, expenseLimitCents: 1 }), /church/);
});
