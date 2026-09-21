/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePayslip,
  findRateTable,
  isIsoCalendarDate,
  STATUTORY_RATE_TABLES,
} from './kenyaPayroll.ts';

const KES = (shillings: number) => Math.round(shillings * 100);
const SEPTEMBER_2026 = '2026-09-30';

test('calculates a worked KES 48,000 example using the 2026 table', () => {
  assert.deepEqual(calculatePayslip(KES(48_000), SEPTEMBER_2026), {
    grossCents: KES(48_000),
    nssfCents: KES(2_880),
    shifCents: KES(1_320),
    ahlCents: KES(720),
    taxablePayCents: KES(43_080),
    payeCents: KES(5_307.35),
    netCents: KES(37_772.65),
    rateVersion: 'KE-2026-02',
    ratesEffectiveFrom: '2026-02-01',
  });
});

test('calculates worked KES 62,000 and KES 85,000 examples', () => {
  const sixtyTwo = calculatePayslip(KES(62_000), SEPTEMBER_2026);
  assert.equal(sixtyTwo.nssfCents, KES(3_720));
  assert.equal(sixtyTwo.shifCents, KES(1_705));
  assert.equal(sixtyTwo.ahlCents, KES(930));
  assert.equal(sixtyTwo.taxablePayCents, KES(55_645));
  assert.equal(sixtyTwo.payeCents, KES(9_076.85));
  assert.equal(sixtyTwo.netCents, KES(46_568.15));

  const eightyFive = calculatePayslip(KES(85_000), SEPTEMBER_2026);
  assert.equal(eightyFive.nssfCents, KES(5_100));
  assert.equal(eightyFive.shifCents, KES(2_337.5));
  assert.equal(eightyFive.ahlCents, KES(1_275));
  assert.equal(eightyFive.taxablePayCents, KES(76_287.5));
  assert.equal(eightyFive.payeCents, KES(15_269.6));
  assert.equal(eightyFive.netCents, KES(61_017.9));
});

test('selects each NSSF phase on its exact effective-date boundary', () => {
  assert.equal(findRateTable('2025-01-31')?.version, 'KE-2024-12');
  assert.equal(findRateTable('2025-02-01')?.version, 'KE-2025-02');
  assert.equal(findRateTable('2026-01-31')?.version, 'KE-2025-02');
  assert.equal(findRateTable('2026-02-01')?.version, 'KE-2026-02');
});

test('caps NSSF at the upper earnings limit for each effective table', () => {
  assert.equal(calculatePayslip(KES(150_000), '2025-01-31').nssfCents, KES(2_160));
  assert.equal(calculatePayslip(KES(150_000), '2025-06-30').nssfCents, KES(4_320));
  assert.equal(calculatePayslip(KES(150_000), '2026-01-31').nssfCents, KES(4_320));
  assert.equal(calculatePayslip(KES(150_000), SEPTEMBER_2026).nssfCents, KES(6_480));
});

test('handles cents immediately around the 2026 NSSF upper limit', () => {
  const upperLimit = KES(108_000);
  // Contributions are rounded to the nearest cent, so one cent below the
  // earnings limit already rounds to the same KES 6,480 contribution.
  assert.equal(calculatePayslip(upperLimit - 1, SEPTEMBER_2026).nssfCents, KES(6_480));
  assert.equal(calculatePayslip(upperLimit, SEPTEMBER_2026).nssfCents, KES(6_480));
  assert.equal(calculatePayslip(upperLimit + 1, SEPTEMBER_2026).nssfCents, KES(6_480));
});

test('uses the 2025 NSSF ceiling in the PAYE taxable-pay calculation', () => {
  const payslip = calculatePayslip(KES(85_000), '2025-06-30');
  assert.equal(payslip.taxablePayCents, KES(77_067.5));
  assert.equal(payslip.payeCents, KES(15_503.6));
  assert.equal(payslip.rateVersion, 'KE-2025-02');
});

test('applies the upper 32.5% and 35% PAYE bands', () => {
  const payslip = calculatePayslip(KES(1_000_000), SEPTEMBER_2026);
  assert.equal(payslip.taxablePayCents, KES(951_020));
  assert.equal(payslip.payeCents, KES(292_740.35));
});

test('applies the SHIF minimum and floors PAYE at zero', () => {
  const payslip = calculatePayslip(KES(10_000), SEPTEMBER_2026);
  assert.equal(payslip.shifCents, KES(300));
  assert.equal(payslip.nssfCents, KES(600));
  assert.equal(payslip.payeCents, 0);
  assert.equal(payslip.netCents, KES(8_950));
});

test('returns zero deductions for zero gross while preserving rate provenance', () => {
  assert.deepEqual(calculatePayslip(0, SEPTEMBER_2026), {
    grossCents: 0,
    nssfCents: 0,
    shifCents: 0,
    ahlCents: 0,
    taxablePayCents: 0,
    payeCents: 0,
    netCents: 0,
    rateVersion: 'KE-2026-02',
    ratesEffectiveFrom: '2026-02-01',
  });
});

test('always returns integer cents and reconciles net pay', () => {
  const grossValues = [1, KES(24_000), KES(33_333.33), KES(107_999.99), KES(812_345.67)];
  for (const grossCents of grossValues) {
    const payslip = calculatePayslip(grossCents, SEPTEMBER_2026);
    assert.equal(
      payslip.netCents,
      payslip.grossCents
        - payslip.nssfCents
        - payslip.shifCents
        - payslip.ahlCents
        - payslip.payeCents,
    );
    for (const value of Object.values(payslip)) {
      if (typeof value === 'number') assert.ok(Number.isSafeInteger(value));
    }
  }
});

test('recognises real ISO calendar dates, including leap-day boundaries', () => {
  assert.equal(isIsoCalendarDate('2024-02-29'), true);
  assert.equal(isIsoCalendarDate('2026-02-28'), true);
  for (const value of [
    '2026-02-29',
    '2025-04-31',
    '2026-00-10',
    '2026-13-01',
    '2026-01-00',
    '2026-01-32',
    '30/09/2026',
    '2026-9-30',
    '',
  ]) {
    assert.equal(isIsoCalendarDate(value), false, value);
    assert.equal(findRateTable(value), null, value);
  }
});

test('rejects malformed calendar dates rather than selecting rates lexically', () => {
  for (const payDate of ['2026-02-29', '2026-13-01', '2025-04-31', '30/09/2026', '']) {
    assert.throws(
      () => calculatePayslip(KES(50_000), payDate),
      /real calendar date in YYYY-MM-DD/,
      payDate,
    );
  }
});

test('refuses otherwise-valid dates before the oldest coded table', () => {
  assert.equal(findRateTable('2024-12-26'), null);
  assert.throws(
    () => calculatePayslip(KES(50_000), '2024-12-26'),
    /No statutory rates are coded/,
  );
});

test('rejects non-finite and non-number gross values', () => {
  for (const grossCents of [NaN, Infinity, -Infinity, '100' as unknown as number]) {
    assert.throws(
      () => calculatePayslip(grossCents, SEPTEMBER_2026),
      /finite number/,
    );
  }
});

test('rejects negative, fractional and unsafe cent values without coercion', () => {
  assert.throws(() => calculatePayslip(-1, SEPTEMBER_2026), /cannot be negative/);
  assert.throws(() => calculatePayslip(1.5, SEPTEMBER_2026), /safe integer number of cents/);
  assert.throws(
    () => calculatePayslip(Number.MAX_SAFE_INTEGER + 1, SEPTEMBER_2026),
    /safe integer number of cents/,
  );
});

test('keeps rate tables in chronological order with unique versions', () => {
  const dates = STATUTORY_RATE_TABLES.map((table) => table.effectiveFrom);
  const versions = STATUTORY_RATE_TABLES.map((table) => table.version);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(dates).size, dates.length);
  assert.equal(new Set(versions).size, versions.length);
  for (const date of dates) assert.equal(isIsoCalendarDate(date), true);
});
