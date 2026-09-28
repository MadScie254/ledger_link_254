/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayslip, findRateTable, STATUTORY_RATE_TABLES } from './kenyaPayroll.ts';

const KES = (shillings: number) => Math.round(shillings * 100);

// Worked examples, pay date 30 September 2026 (NSSF year 4: LEL 9,000, UEL 108,000).
//
// Taxable pay = gross - NSSF - SHIF - Housing Levy.
// Tax = 10% of the first 24,000 (2,400) + 25% of the next 8,333 (2,083.25)
//     + 30% of taxable pay above 32,333; PAYE = tax - 2,400 personal relief.
const SEPT_2026 = '2026-09-30';

test('gross 48,000', () => {
  // NSSF 6% x 48,000 = 2,880 (Tier I 540 + Tier II 2,340)
  // SHIF 2.75% = 1,320; Housing Levy 1.5% = 720
  // Taxable 48,000 - 2,880 - 1,320 - 720 = 43,080
  // Tax 2,400 + 2,083.25 + 30% x 10,747 (3,224.10) = 7,707.35; PAYE 5,307.35
  // Net 48,000 - 2,880 - 1,320 - 720 - 5,307.35 = 37,772.65
  assert.deepEqual(calculatePayslip(KES(48_000), SEPT_2026), {
    grossCents: KES(48_000),
    nssfCents: KES(2_880),
    shifCents: KES(1_320),
    ahlCents: KES(720),
    taxablePayCents: KES(43_080),
    payeCents: KES(5_307.35),
    netCents: KES(37_772.65),
    ratesEffectiveFrom: '2026-02-01',
  });
});

test('gross 62,000', () => {
  // NSSF 3,720; SHIF 1,705; Housing Levy 930
  // Taxable 62,000 - 6,355 = 55,645
  // Tax 2,400 + 2,083.25 + 30% x 23,312 (6,993.60) = 11,476.85; PAYE 9,076.85
  // Net 62,000 - 3,720 - 1,705 - 930 - 9,076.85 = 46,568.15
  assert.deepEqual(calculatePayslip(KES(62_000), SEPT_2026), {
    grossCents: KES(62_000),
    nssfCents: KES(3_720),
    shifCents: KES(1_705),
    ahlCents: KES(930),
    taxablePayCents: KES(55_645),
    payeCents: KES(9_076.85),
    netCents: KES(46_568.15),
    ratesEffectiveFrom: '2026-02-01',
  });
});

test('gross 85,000', () => {
  // NSSF 5,100; SHIF 2,337.50; Housing Levy 1,275
  // Taxable 85,000 - 8,712.50 = 76,287.50
  // Tax 2,400 + 2,083.25 + 30% x 43,954.50 (13,186.35) = 17,669.60; PAYE 15,269.60
  // Net 85,000 - 5,100 - 2,337.50 - 1,275 - 15,269.60 = 61,017.90
  assert.deepEqual(calculatePayslip(KES(85_000), SEPT_2026), {
    grossCents: KES(85_000),
    nssfCents: KES(5_100),
    shifCents: KES(2_337.5),
    ahlCents: KES(1_275),
    taxablePayCents: KES(76_287.5),
    payeCents: KES(15_269.6),
    netCents: KES(61_017.9),
    ratesEffectiveFrom: '2026-02-01',
  });
});

test('NSSF stops at the upper earnings limit in force on the pay date', () => {
  // Year 4 (from 1 Feb 2026): 6% x 108,000 = 6,480
  assert.equal(calculatePayslip(KES(150_000), SEPT_2026).nssfCents, KES(6_480));
  // Year 3 (1 Feb 2025 to 31 Jan 2026): 6% x 72,000 = 4,320
  assert.equal(calculatePayslip(KES(150_000), '2025-06-30').nssfCents, KES(4_320));
  assert.equal(calculatePayslip(KES(150_000), '2026-01-31').nssfCents, KES(4_320));
  // Year 2 (27 Dec 2024 to 31 Jan 2025 in these tables): 6% x 36,000 = 2,160
  assert.equal(calculatePayslip(KES(150_000), '2025-01-31').nssfCents, KES(2_160));
});

test('gross 85,000 on a 2025 pay date uses the year 3 NSSF limit', () => {
  // NSSF 6% x 72,000 = 4,320; SHIF 2,337.50; Housing Levy 1,275
  // Taxable 85,000 - 7,932.50 = 77,067.50
  // Tax 2,400 + 2,083.25 + 30% x 44,734.50 (13,420.35) = 17,903.60; PAYE 15,503.60
  const p = calculatePayslip(KES(85_000), '2025-06-30');
  assert.equal(p.taxablePayCents, KES(77_067.5));
  assert.equal(p.payeCents, KES(15_503.6));
  assert.equal(p.ratesEffectiveFrom, '2025-02-01');
});

test('upper PAYE bands: 32.5% above 500,000 and 35% above 800,000', () => {
  // Gross 1,000,000: NSSF 6,480; SHIF 27,500; Housing Levy 15,000
  // Taxable 1,000,000 - 48,980 = 951,020
  // Tax 2,400 + 2,083.25 + 30% x 467,667 (140,300.10) + 32.5% x 300,000 (97,500)
  //   + 35% x 151,020 (52,857) = 295,140.35; PAYE 292,740.35
  const p = calculatePayslip(KES(1_000_000), SEPT_2026);
  assert.equal(p.taxablePayCents, KES(951_020));
  assert.equal(p.payeCents, KES(292_740.35));
});

test('SHIF minimum of KES 300 and no PAYE below personal relief', () => {
  // Gross 10,000: SHIF 2.75% = 275, raised to the 300 minimum.
  // NSSF 600; Housing Levy 150; taxable 8,950; tax 895 < 2,400 relief.
  const p = calculatePayslip(KES(10_000), SEPT_2026);
  assert.equal(p.shifCents, KES(300));
  assert.equal(p.nssfCents, KES(600));
  assert.equal(p.payeCents, 0);
  assert.equal(p.netCents, KES(10_000 - 600 - 300 - 150));
});

test('zero gross gives zero deductions', () => {
  const p = calculatePayslip(0, SEPT_2026);
  assert.equal(p.shifCents, 0);
  assert.equal(p.netCents, 0);
});

test('net pay always equals gross less every deduction', () => {
  for (const gross of [KES(24_000), KES(33_333.33), KES(107_999.99), KES(812_345.67)]) {
    const p = calculatePayslip(gross, SEPT_2026);
    assert.equal(p.netCents, p.grossCents - p.nssfCents - p.shifCents - p.ahlCents - p.payeCents);
    for (const v of Object.values(p)) if (typeof v === 'number') assert.ok(Number.isInteger(v));
  }
});

test('rate tables are chosen by pay date and refuse dates before the first table', () => {
  assert.equal(findRateTable('2026-02-01')?.effectiveFrom, '2026-02-01');
  assert.equal(findRateTable('2024-12-26'), null);
  assert.equal(findRateTable('30/09/2026'), null);
  assert.equal(findRateTable(''), null);
  assert.throws(() => calculatePayslip(KES(50_000), '2024-06-30'), /No statutory rates are coded/);
  const dates = STATUTORY_RATE_TABLES.map((t) => t.effectiveFrom);
  assert.deepEqual(dates, [...dates].sort());
});
