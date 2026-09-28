/**
 * Kenyan statutory payroll deductions: PAYE, NSSF, SHIF and the Affordable
 * Housing Levy. One implementation, imported by the server (which posts pay
 * runs) and by the Payroll screen (which previews them), so the two can never
 * disagree. Everything is integer cents; no imports, so it runs anywhere.
 *
 * Rates are held as tables with an effective-from date and chosen by the pay
 * date of the run. When the law changes, add a table; never edit one that has
 * already been used, because posted runs were computed from it.
 *
 * Rules, as checked on 17 September 2026:
 *
 * PAYE bands and personal relief: Income Tax Act s.35 and Third Schedule, as
 *   amended by the Finance Act 2023 (bands from 1 July 2023). Monthly bands:
 *   10% to 24,000; 25% to 32,333; 30% to 500,000; 32.5% to 800,000; 35% above.
 *   Personal relief KES 2,400 a month. The Finance Act 2026 (assented
 *   23 June 2026) left the bands and relief unchanged.
 *   https://www.ey.com/en_gl/technical/tax-alerts/kenya-enacts-finance-act-2026
 *
 * Deductions before PAYE: Tax Laws (Amendment) Act 2024, in force
 *   27 December 2024. The employee's SHIF contribution and Affordable Housing
 *   Levy are deductible in computing taxable employment income, replacing the
 *   15% housing relief. Contributions to registered pension and social security
 *   schemes, which include NSSF, are deductible up to KES 30,000 a month.
 *   KRA public notice of 19 December 2024:
 *   https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024
 *
 * NSSF: NSSF Act 2013, s.20 and Third Schedule, phased in from February 2023.
 *   6% employee share (matched by the employer). Tier I on pay up to the lower
 *   earnings limit, Tier II on pay between the lower and upper limits.
 *     Year 2, from 1 Feb 2024: LEL 7,000, UEL 36,000
 *     Year 3, from 1 Feb 2025: LEL 8,000, UEL 72,000
 *     Year 4, from 1 Feb 2026: LEL 9,000, UEL 108,000 (maximum KES 6,480)
 *   https://assets.kpmg.com/content/dam/kpmgsites/ke/pdf/thought_leaderships/tax/2026/Phase-4-of-NSSF-Contribution-Rates-effective-February-2026.pdf.coredownload.inline.pdf
 *   Year 5 (February 2027) ties the limits to the minimum wage and national
 *   average earnings, which had not been published when this was written.
 *
 * SHIF: Social Health Insurance Act 2023 s.27 and the Social Health Insurance
 *   (General) Regulations 2024, collected from 1 October 2024. 2.75% of gross
 *   salary, minimum KES 300 a month, no maximum.
 *   https://www.ey.com/en_gl/technical/tax-alerts/kenya-employers-to-begin-making-contributions-to-social-health-insurance-fund
 *
 * Affordable Housing Levy: Affordable Housing Act 2024 s.4, from 19 March 2024.
 *   1.5% of gross salary from the employee, matched by the employer.
 *
 * Not modelled here: the post-retirement medical fund and mortgage interest
 * deductions, and non-cash benefits, because employee records do not hold them.
 */

export interface PayeBand {
  /** Upper bound of the band in cents; null for the top band. */
  upToCents: number | null;
  rate: number;
}

export interface StatutoryRateTable {
  /** First pay date (YYYY-MM-DD) these rates apply to. */
  effectiveFrom: string;
  source: string;
  payeBands: PayeBand[];
  personalReliefCents: number;
  nssf: { rate: number; lowerEarningsLimitCents: number; upperEarningsLimitCents: number };
  shif: { rate: number; minimumCents: number };
  housingLevyRate: number;
  /** Monthly cap on pension and NSSF contributions deductible before PAYE. */
  pensionDeductionCapCents: number;
}

const KES = (shillings: number) => shillings * 100;

const PAYE_BANDS_FINANCE_ACT_2023: PayeBand[] = [
  { upToCents: KES(24_000), rate: 0.10 },
  { upToCents: KES(32_333), rate: 0.25 },
  { upToCents: KES(500_000), rate: 0.30 },
  { upToCents: KES(800_000), rate: 0.325 },
  { upToCents: null, rate: 0.35 },
];

const COMMON = {
  payeBands: PAYE_BANDS_FINANCE_ACT_2023,
  personalReliefCents: KES(2_400),
  shif: { rate: 0.0275, minimumCents: KES(300) },
  housingLevyRate: 0.015,
  pensionDeductionCapCents: KES(30_000),
};

/** Oldest first. Pay dates before the first table are refused. */
export const STATUTORY_RATE_TABLES: readonly StatutoryRateTable[] = [
  {
    effectiveFrom: '2024-12-27',
    source: 'Tax Laws (Amendment) Act 2024; NSSF Act 2013 Third Schedule, year 2',
    ...COMMON,
    nssf: { rate: 0.06, lowerEarningsLimitCents: KES(7_000), upperEarningsLimitCents: KES(36_000) },
  },
  {
    effectiveFrom: '2025-02-01',
    source: 'NSSF Act 2013 Third Schedule, year 3',
    ...COMMON,
    nssf: { rate: 0.06, lowerEarningsLimitCents: KES(8_000), upperEarningsLimitCents: KES(72_000) },
  },
  {
    effectiveFrom: '2026-02-01',
    source: 'NSSF Act 2013 Third Schedule, year 4',
    ...COMMON,
    nssf: { rate: 0.06, lowerEarningsLimitCents: KES(9_000), upperEarningsLimitCents: KES(108_000) },
  },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The rate table in force on a pay date (YYYY-MM-DD), or null when none covers it. */
export function findRateTable(payDate: string): StatutoryRateTable | null {
  if (!ISO_DATE.test(payDate)) return null;
  let found: StatutoryRateTable | null = null;
  for (const table of STATUTORY_RATE_TABLES) {
    if (table.effectiveFrom <= payDate) found = table;
  }
  return found;
}

export interface PayslipBreakdown {
  grossCents: number;
  nssfCents: number;
  shifCents: number;
  ahlCents: number;
  /** Gross less NSSF, SHIF and the Housing Levy: the pay PAYE is charged on. */
  taxablePayCents: number;
  payeCents: number;
  netCents: number;
  /** effectiveFrom of the rate table used. */
  ratesEffectiveFrom: string;
}

function taxOnBands(taxableCents: number, bands: PayeBand[]): number {
  let tax = 0;
  let lower = 0;
  for (const band of bands) {
    if (taxableCents <= lower) break;
    const upper = band.upToCents ?? Infinity;
    tax += (Math.min(taxableCents, upper) - lower) * band.rate;
    lower = upper;
  }
  return tax;
}

/**
 * Deductions for one month's gross pay, using the rates in force on payDate.
 * Throws when payDate is not YYYY-MM-DD or predates the coded rates.
 */
export function calculatePayslip(grossCents: number, payDate: string): PayslipBreakdown {
  const rates = findRateTable(payDate);
  if (!rates) {
    throw new Error(
      `No statutory rates are coded for pay date "${payDate}". Rates are coded from ${STATUTORY_RATE_TABLES[0].effectiveFrom}.`
    );
  }

  const gross = Math.max(Math.round(grossCents || 0), 0);
  if (gross === 0) {
    return { grossCents: 0, nssfCents: 0, shifCents: 0, ahlCents: 0, taxablePayCents: 0, payeCents: 0, netCents: 0, ratesEffectiveFrom: rates.effectiveFrom };
  }

  const { nssf: n } = rates;
  const tier1 = Math.round(Math.min(gross, n.lowerEarningsLimitCents) * n.rate);
  const tier2 = Math.round(Math.max(Math.min(gross, n.upperEarningsLimitCents) - n.lowerEarningsLimitCents, 0) * n.rate);
  const nssfCents = tier1 + tier2;

  const shifCents = Math.max(Math.round(gross * rates.shif.rate), rates.shif.minimumCents);
  const ahlCents = Math.round(gross * rates.housingLevyRate);

  const pensionDeduction = Math.min(nssfCents, rates.pensionDeductionCapCents);
  const taxablePayCents = Math.max(gross - pensionDeduction - shifCents - ahlCents, 0);
  const payeCents = Math.max(Math.round(taxOnBands(taxablePayCents, rates.payeBands)) - rates.personalReliefCents, 0);

  return {
    grossCents: gross,
    nssfCents,
    shifCents,
    ahlCents,
    taxablePayCents,
    payeCents,
    netCents: gross - nssfCents - shifCents - ahlCents - payeCents,
    ratesEffectiveFrom: rates.effectiveFrom,
  };
}
