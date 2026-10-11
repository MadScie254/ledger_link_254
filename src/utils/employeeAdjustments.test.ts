import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculatePayslip, STATUTORY_RATE_TABLES } from './kenyaPayroll.ts';
import type { AdjustmentRule, AdjustmentType, EmployeeAdjustment } from './employeeAdjustments.ts';

const sql = readFileSync(new URL('../../supabase/migrations/20261011000200_employee_adjustment_evidence.sql', import.meta.url), 'utf8');
const rules: AdjustmentRule[] = [...sql.matchAll(/\('([A-Z_]+)', (\d+)(?:::bigint)?, ([\d.]+)(?:::numeric)?, '([^']+)'\)/g)]
  .map((m) => ({ type: m[1] as AdjustmentType, monthlyCapCents: Number(m[2]), rate: Number(m[3]), source: m[4], verified: false }));
const rates = { ...STATUTORY_RATE_TABLES[2], adjustmentRules: rules };
const evidence = (type: AdjustmentType, amountCents: number, id: string = type): EmployeeAdjustment => ({
  id, type, amountCents, validFrom: '2026-01-01', validTo: '2026-12-31', referenceNumber: 'CERT-1', attachmentId: null,
});

test('relief seed has all five types, dated sources and unverified limits', () => {
  assert.equal(rules.length, 5);
  for (const rule of rules) { assert.match(rule.source, /https:\/\/www.kra.go.ke\//); assert.equal(rule.verified, false); }
});
test('additional pension shares its cap with NSSF, and multiple records share each cap', () => {
  const base = calculatePayslip(20_000_000, '2026-09-30', rates);
  const slip = calculatePayslip(20_000_000, '2026-09-30', rates, [
    evidence('REGISTERED_PENSION', 4_000_000), evidence('MORTGAGE_INTEREST', 2_000_000, 'a'), evidence('MORTGAGE_INTEREST', 2_000_000, 'b'),
  ]);
  assert.equal(base.taxablePayCents - slip.taxablePayCents, 3_000_000 - base.nssfCents + 3_000_000);
  assert.equal(slip.appliedAdjustments.find((r) => r.id === 'b')?.appliedCents, 1_000_000);
  assert.equal(slip.netCents - base.netCents, base.payeCents - slip.payeCents, 'evidence does not withhold cash');
});
test('evidence applies on inclusive date boundaries and expires afterwards', () => {
  const record = { ...evidence('POST_RETIREMENT_MEDICAL', 2_000_000), validFrom: '2026-09-01', validTo: '2026-09-30' };
  for (const date of ['2026-09-01', '2026-09-30']) assert.equal(calculatePayslip(10_000_000, date, rates, [record]).appliedAdjustments[0].appliedCents, 1_500_000);
  for (const date of ['2026-08-31', '2026-10-01']) assert.equal(calculatePayslip(10_000_000, date, rates, [record]).appliedAdjustments.length, 0);
});
test('insurance is a credit after personal relief and cannot make PAYE negative', () => {
  const base = calculatePayslip(10_000_000, '2026-09-30', rates);
  const insured = calculatePayslip(10_000_000, '2026-09-30', rates, [evidence('INSURANCE_PREMIUM', 10_000_000)]);
  assert.equal(base.payeCents - insured.payeCents, 500_000);
  const low = calculatePayslip(1_000_000, '2026-09-30', rates, [evidence('INSURANCE_PREMIUM', 10_000_000)]);
  assert.equal(low.payeCents, 0); assert.equal(low.appliedAdjustments[0].appliedCents, 0);
});
test('disability exemption reduces chargeable income with deductions and floors it at zero', () => {
  const base = calculatePayslip(20_000_000, '2026-09-30', rates);
  const exempt = calculatePayslip(20_000_000, '2026-09-30', rates, [evidence('DISABILITY_EXEMPTION', 15_000_000)]);
  assert.equal(exempt.taxablePayCents, base.taxablePayCents - 15_000_000);
  const zero = calculatePayslip(10_000_000, '2026-09-30', rates, [evidence('DISABILITY_EXEMPTION', 15_000_000)]);
  assert.equal(zero.taxablePayCents, 0); assert.equal(zero.payeCents, 0);
});
test('a payslip keeps a copied evidence snapshot and refuses missing rate rules', () => {
  const record = evidence('MORTGAGE_INTEREST', 100_000);
  const slip = calculatePayslip(10_000_000, '2026-09-30', rates, [record]);
  record.referenceNumber = 'changed';
  assert.equal(slip.appliedAdjustments[0].referenceNumber, 'CERT-1');
  assert.throws(() => calculatePayslip(10_000_000, '2026-09-30', STATUTORY_RATE_TABLES[2], [record]), /No sourced rate rule/);
});
