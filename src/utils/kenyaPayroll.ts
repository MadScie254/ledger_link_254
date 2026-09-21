/**
 * Effective-dated Kenyan payroll deductions.
 *
 * This module deliberately has no browser or server dependencies so the pay-run
 * preview and the posting workflow can share exactly the same calculation.
 * Amounts are integer cents. Add a new immutable rate table when legislation
 * changes; do not rewrite a table that may already have been used for a run.
 *
 * Rates reviewed 17 September 2026 against KRA guidance, the NSSF Year 4
 * notice, the Social Health Insurance Regulations and the Affordable Housing
 * Act. This calculator is an implementation aid, not filing advice.
 */

export interface PayeBand {
  /** Inclusive upper boundary for this band in cents; null is unbounded. */
  readonly upToCents: number | null;
  readonly rate: number;
}

export interface StatutoryRateTable {
  /** Stable identifier suitable for showing alongside a payroll preview. */
  readonly version: string;
  /** First pay date, in YYYY-MM-DD form, on which the table applies. */
  readonly effectiveFrom: string;
  readonly source: string;
  readonly payeBands: readonly PayeBand[];
  readonly personalReliefCents: number;
  readonly nssf: {
    readonly rate: number;
    readonly lowerEarningsLimitCents: number;
    readonly upperEarningsLimitCents: number;
  };
  readonly shif: { readonly rate: number; readonly minimumCents: number };
  readonly housingLevyRate: number;
  /** Monthly ceiling for deductible pension/social-security contributions. */
  readonly pensionDeductionCapCents: number;
}

export interface PayslipBreakdown {
  readonly grossCents: number;
  readonly nssfCents: number;
  readonly shifCents: number;
  readonly ahlCents: number;
  /** Gross less the deductions currently supported before PAYE. */
  readonly taxablePayCents: number;
  readonly payeCents: number;
  readonly netCents: number;
  readonly rateVersion: string;
  readonly ratesEffectiveFrom: string;
}

export const UNSUPPORTED_EMPLOYEE_ADJUSTMENTS = [
  'additional registered-pension contributions',
  'mortgage-interest deductions',
  'post-retirement medical-fund contributions',
  'taxable non-cash benefits',
  'employee-specific exemptions and reliefs',
] as const;

const KES = (shillings: number) => shillings * 100;

const PAYE_BANDS_FINANCE_ACT_2023: readonly PayeBand[] = [
  { upToCents: KES(24_000), rate: 0.10 },
  { upToCents: KES(32_333), rate: 0.25 },
  { upToCents: KES(500_000), rate: 0.30 },
  { upToCents: KES(800_000), rate: 0.325 },
  { upToCents: null, rate: 0.35 },
];

const COMMON_RATES = {
  payeBands: PAYE_BANDS_FINANCE_ACT_2023,
  personalReliefCents: KES(2_400),
  shif: { rate: 0.0275, minimumCents: KES(300) },
  housingLevyRate: 0.015,
  pensionDeductionCapCents: KES(30_000),
} as const;

/** Oldest first. Pay dates before the first table are intentionally refused. */
export const STATUTORY_RATE_TABLES: readonly StatutoryRateTable[] = [
  {
    version: 'KE-2024-12',
    effectiveFrom: '2024-12-27',
    source: 'Tax Laws (Amendment) Act 2024; NSSF Third Schedule Year 2',
    ...COMMON_RATES,
    nssf: {
      rate: 0.06,
      lowerEarningsLimitCents: KES(7_000),
      upperEarningsLimitCents: KES(36_000),
    },
  },
  {
    version: 'KE-2025-02',
    effectiveFrom: '2025-02-01',
    source: 'NSSF Third Schedule Year 3; Tax Laws (Amendment) Act 2024',
    ...COMMON_RATES,
    nssf: {
      rate: 0.06,
      lowerEarningsLimitCents: KES(8_000),
      upperEarningsLimitCents: KES(72_000),
    },
  },
  {
    version: 'KE-2026-02',
    effectiveFrom: '2026-02-01',
    source: 'NSSF Third Schedule Year 4; Tax Laws (Amendment) Act 2024',
    ...COMMON_RATES,
    nssf: {
      rate: 0.06,
      lowerEarningsLimitCents: KES(9_000),
      upperEarningsLimitCents: KES(108_000),
    },
  },
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for an actual Gregorian calendar date written as YYYY-MM-DD. */
export function isIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** The rate table in force on a real pay date, or null when none covers it. */
export function findRateTable(payDate: string): StatutoryRateTable | null {
  if (!isIsoCalendarDate(payDate)) return null;

  let found: StatutoryRateTable | null = null;
  for (const table of STATUTORY_RATE_TABLES) {
    if (table.effectiveFrom <= payDate) found = table;
  }
  return found;
}

function assertValidCents(grossCents: number): void {
  if (!Number.isFinite(grossCents)) {
    throw new TypeError('grossCents must be a finite number.');
  }
  if (!Number.isSafeInteger(grossCents)) {
    throw new RangeError('grossCents must be a safe integer number of cents.');
  }
  if (grossCents < 0) {
    throw new RangeError('grossCents cannot be negative.');
  }
}

function taxOnBands(taxableCents: number, bands: readonly PayeBand[]): number {
  let tax = 0;
  let lowerBoundary = 0;

  for (const band of bands) {
    if (taxableCents <= lowerBoundary) break;
    const upperBoundary = band.upToCents ?? Infinity;
    tax += (Math.min(taxableCents, upperBoundary) - lowerBoundary) * band.rate;
    lowerBoundary = upperBoundary;
  }

  return tax;
}

/**
 * Calculate one month's statutory employee deductions for the supplied pay
 * date. Invalid dates, unsupported historical dates and imprecise cent values
 * are rejected rather than silently coerced.
 */
export function calculatePayslip(grossCents: number, payDate: string): PayslipBreakdown {
  assertValidCents(grossCents);

  if (!isIsoCalendarDate(payDate)) {
    throw new RangeError(`payDate must be a real calendar date in YYYY-MM-DD form; received "${payDate}".`);
  }

  const rates = findRateTable(payDate);
  if (!rates) {
    throw new RangeError(
      `No statutory rates are coded for ${payDate}. Rates begin on ${STATUTORY_RATE_TABLES[0].effectiveFrom}.`,
    );
  }

  if (grossCents === 0) {
    return {
      grossCents: 0,
      nssfCents: 0,
      shifCents: 0,
      ahlCents: 0,
      taxablePayCents: 0,
      payeCents: 0,
      netCents: 0,
      rateVersion: rates.version,
      ratesEffectiveFrom: rates.effectiveFrom,
    };
  }

  const tierOneCents = Math.round(
    Math.min(grossCents, rates.nssf.lowerEarningsLimitCents) * rates.nssf.rate,
  );
  const tierTwoCents = Math.round(
    Math.max(
      Math.min(grossCents, rates.nssf.upperEarningsLimitCents)
        - rates.nssf.lowerEarningsLimitCents,
      0,
    ) * rates.nssf.rate,
  );
  const nssfCents = tierOneCents + tierTwoCents;
  const shifCents = Math.max(
    Math.round(grossCents * rates.shif.rate),
    rates.shif.minimumCents,
  );
  const ahlCents = Math.round(grossCents * rates.housingLevyRate);

  const pensionDeductionCents = Math.min(nssfCents, rates.pensionDeductionCapCents);
  const taxablePayCents = Math.max(
    grossCents - pensionDeductionCents - shifCents - ahlCents,
    0,
  );
  const payeCents = Math.max(
    Math.round(taxOnBands(taxablePayCents, rates.payeBands)) - rates.personalReliefCents,
    0,
  );

  return {
    grossCents,
    nssfCents,
    shifCents,
    ahlCents,
    taxablePayCents,
    payeCents,
    netCents: grossCents - nssfCents - shifCents - ahlCents - payeCents,
    rateVersion: rates.version,
    ratesEffectiveFrom: rates.effectiveFrom,
  };
}
