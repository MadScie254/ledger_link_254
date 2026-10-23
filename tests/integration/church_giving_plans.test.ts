import assert from 'node:assert/strict';
import test from 'node:test';
import { OrganizationService } from '../../src/server/organizations';
import { FundsService } from '../../src/server/funds';
import { GivingService } from '../../src/server/giving';
import { GivingPlanService } from '../../src/server/givingPlans';
import { getSupabase } from '../../src/server/supabase';
import { OWNER, MEMBER, sql, refused, uuid } from './helpers';

test('monthly giving plans compare intentions with posted member gifts', async () => {
  const church = await OrganizationService.createOrganization({ name: 'Plans church', country: 'Kenya', edition: 'church' } as any, OWNER);
  const general = (await FundsService.list(church)).find((fund) => fund.code === 'GENERAL')!;
  const { data: member, error } = await getSupabase().from('members')
    .insert({ org_id: church, member_number: 'P-1', first_name: 'Peter' }).select('id').single();
  if (error) throw error;
  sql(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${church}', '${MEMBER}', 'member')`);
  const planId = await GivingPlanService.create(church, OWNER, {
    memberId: member.id, fundId: general.id, monthlyCents: 50000, startsOn: '2026-01-01',
  });
  await GivingService.recordGift(church, OWNER, { memberId: member.id, fundId: general.id,
    amountCents: 25000, method: 'BANK', receivedOn: '2026-03-12', idempotencyKey: uuid() });
  const march = await GivingPlanService.list(church, '2026-03');
  assert.equal(march.plans[0].monthlyCents, 50000);
  assert.equal(march.plans[0].receivedCents, 25000);
  assert.equal(march.plans[0].status, 'PARTIAL');
  await GivingPlanService.stop(church, OWNER, planId, '2026-03-31');
  assert.equal((await GivingPlanService.list(church, '2026-04')).plans.length, 0);
  await refused(GivingPlanService.create(church, MEMBER, {
    memberId: member.id, fundId: general.id, monthlyCents: 1, startsOn: '2026-04-01',
  }), /bookkeeper/);
});
