import assert from 'node:assert/strict';
import test from 'node:test';
import { OrganizationService } from '../../src/server/organizations';
import { FundsService } from '../../src/server/funds';
import { GivingService } from '../../src/server/giving';
import { ChurchReportService } from '../../src/server/churchReports';
import { OWNER, refused, uuid } from './helpers';

test('a fund project report follows posted gifts and respects its period', async () => {
  const church = await OrganizationService.createOrganization({ name: 'Project report church', country: 'Kenya', edition: 'church' } as any, OWNER);
  const building = (await FundsService.list(church)).find((fund) => fund.code === 'BUILDING')!;
  await GivingService.recordGift(church, OWNER, { fundId: building.id, amountCents: 82000,
    method: 'BANK', receivedOn: '2026-03-12', idempotencyKey: uuid() });
  const march = await ChurchReportService.fundDetail(church, building.id, '2026-03-01', '2026-03-31');
  assert.equal(march.incomeCents, 82000);
  assert.equal(march.closingCents, 82000);
  assert.equal(march.incomeByAccount.reduce((sum, row) => sum + row.amountCents, 0), 82000);
  const february = await ChurchReportService.fundDetail(church, building.id, '2026-02-01', '2026-02-28');
  assert.equal(february.incomeCents, 0);
  await refused(ChurchReportService.fundDetail(church, uuid(), '2026-03-01', '2026-03-31'), /Fund not found/);
});
