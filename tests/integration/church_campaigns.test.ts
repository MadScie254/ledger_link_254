import assert from 'node:assert/strict';
import test from 'node:test';
import { OrganizationService } from '../../src/server/organizations';
import { FundsService } from '../../src/server/funds';
import { GivingService } from '../../src/server/giving';
import { ChurchCampaignService } from '../../src/server/churchCampaigns';
import { getSupabase } from '../../src/server/supabase';
import { OWNER, MEMBER, sql, refused, uuid } from './helpers';

test('a campaign and pledge follow posted giving without posting the pledge', async () => {
  const church = await OrganizationService.createOrganization({ name: 'Campaign church', country: 'Kenya', edition: 'church' } as any, OWNER);
  const building = (await FundsService.list(church)).find((fund) => fund.code === 'BUILDING')!;
  const { data: member, error } = await getSupabase().from('members')
    .insert({ org_id: church, member_number: 'M-1', first_name: 'Miriam' }).select('id').single();
  if (error) throw error;
  sql(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${church}', '${MEMBER}', 'member')`);
  const campaignId = await ChurchCampaignService.create(church, OWNER, {
    fundId: building.id, name: 'Roof repairs', goalCents: 5000000, startsOn: '2026-01-01', endsOn: '2026-12-31',
  });
  await ChurchCampaignService.pledge(church, OWNER, campaignId, {
    memberId: member.id, pledgedCents: 100000, pledgedOn: '2026-02-01', dueOn: '2026-11-30', note: null,
  });
  const before = await ChurchCampaignService.list(church);
  assert.equal(before.campaigns[0].givenCents, 0);
  assert.equal(before.campaigns[0].pledgedCents, 100000);
  await GivingService.recordGift(church, OWNER, { memberId: member.id, fundId: building.id,
    amountCents: 25000, method: 'BANK', receivedOn: '2026-03-01', idempotencyKey: uuid() });
  const after = await ChurchCampaignService.list(church);
  assert.equal(after.campaigns[0].givenCents, 25000);
  assert.equal(after.campaigns[0].pledges[0].receivedCents, 25000);
  await ChurchCampaignService.close(church, OWNER, campaignId, '2026-10-13');
  const closed = await ChurchCampaignService.list(church);
  assert.equal(closed.campaigns[0].status, 'CLOSED');
  await refused(ChurchCampaignService.pledge(church, OWNER, campaignId, {
    memberId: member.id, pledgedCents: 100, pledgedOn: '2026-10-13', dueOn: null, note: null,
  }), /open campaign/);
  await refused(ChurchCampaignService.create(church, MEMBER, {
    fundId: building.id, name: 'Another', goalCents: 1, startsOn: '2027-01-01', endsOn: null,
  }), /owner or admin/);
});
