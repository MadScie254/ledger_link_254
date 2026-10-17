import { isCalendarDate as isIsoCalendarDate } from './dates.ts';

export const ADJUSTMENT_TYPES = ['REGISTERED_PENSION', 'MORTGAGE_INTEREST', 'POST_RETIREMENT_MEDICAL', 'INSURANCE_PREMIUM', 'DISABILITY_EXEMPTION'] as const;
export type AdjustmentType = typeof ADJUSTMENT_TYPES[number];
export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  REGISTERED_PENSION: 'Additional registered pension',
  MORTGAGE_INTEREST: 'Mortgage interest',
  POST_RETIREMENT_MEDICAL: 'Post-retirement medical fund',
  INSURANCE_PREMIUM: 'Insurance premium',
  DISABILITY_EXEMPTION: 'Disability exemption',
};
export interface EmployeeAdjustment {
  id: string;
  type: AdjustmentType;
  amountCents: number;
  validFrom: string;
  validTo: string | null;
  referenceNumber: string;
  attachmentId: string | null;
}
export interface AdjustmentRule {
  type: AdjustmentType;
  monthlyCapCents: number;
  rate: number;
  source: string;
  verified: boolean;
}
export interface AppliedAdjustment extends EmployeeAdjustment {
  appliedCents: number;
  source: string;
  verified: boolean;
}

/** Evidence is tax-only: it does not withhold additional cash from net salary. */
export function applyEmployeeAdjustments(
  records: readonly EmployeeAdjustment[], date: string, rules: readonly AdjustmentRule[],
  taxableBeforeAdjustments: number, pensionAlreadyDeducted: number,
) {
  let taxablePayCents = taxableBeforeAdjustments;
  let insuranceReliefCents = 0;
  const used = new Map<AdjustmentType, number>([['REGISTERED_PENSION', pensionAlreadyDeducted]]);
  const appliedAdjustments: AppliedAdjustment[] = [];
  for (const record of [...records].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!isIsoCalendarDate(record.validFrom) || (record.validTo !== null && !isIsoCalendarDate(record.validTo))) throw new Error('Adjustment evidence has an invalid date.');
    if (record.validFrom > date || (record.validTo !== null && record.validTo < date)) continue;
    if (!Number.isSafeInteger(record.amountCents) || record.amountCents < 0 || !record.referenceNumber.trim()) throw new Error('Adjustment evidence needs whole cents and a reference number.');
    const rule = rules.find((r) => r.type === record.type);
    if (!rule) throw new Error(`No sourced rate rule is available for ${ADJUSTMENT_LABELS[record.type]}.`);
    const remaining = Math.max(0, rule.monthlyCapCents - (used.get(record.type) ?? 0));
    const allowed = Math.min(Math.round(record.amountCents * rule.rate), remaining);
    const appliedCents = record.type === 'INSURANCE_PREMIUM' ? allowed : Math.min(allowed, taxablePayCents);
    used.set(record.type, (used.get(record.type) ?? 0) + appliedCents);
    if (record.type === 'INSURANCE_PREMIUM') insuranceReliefCents += appliedCents;
    else taxablePayCents -= appliedCents;
    appliedAdjustments.push({ ...record, appliedCents, source: rule.source, verified: rule.verified });
  }
  return { taxablePayCents, insuranceReliefCents, appliedAdjustments };
}
