# Kenya and East Africa compliance reference for Ledger Link (as of 1 October 2026)

> **How these notes were made, and their limits.** WebFetch was blocked by the egress proxy for every domain tried (kra.go.ke, kenyalaw.org, pwc.com, taxsummaries.pwc.com, assets.kpmg.com, ey.com, globaltaxnews.ey.com, cliffedekkerhofmeyr.com, grantthornton.co.ke, mondaq.com, the-star.co.ke, odpc.go.ke, ifrs.org). The session-wide web-search budget ran out after about 25 searches. So every **Cited Finding** below comes from search-engine result summaries of the linked page, not from reading the full page. Treat exact wording as close to the source, not verbatim. Anything marked **[BACKGROUND – VERIFY]** comes from model knowledge (to about mid-2026) and was **not** confirmed in this session. It sits under Gaps or Inferences, never under Cited Findings. Data protection, accounting standards, iTax file formats and the East Africa material are mostly in that unverified category.
>
> Where useful, findings were checked against the current code in `src/utils/kenyaPayroll.ts` (rate tables) and `src/utils/statutory.ts` (calendar).

---

## 1. Kenya PAYE: bands, reliefs, allowable deductions (TLAA 2024, Finance Act 2025, Finance Act 2026, pending PAYE bill)

### Takeaway
As of October 2026 the monthly PAYE bands and the KES 2,400 personal relief are unchanged. Neither the Finance Act 2025 nor the Finance Act 2026 amended them. The Tax Laws (Amendment) Act 2024 (TLAA 2024), effective 27 Dec 2024 and applying to December 2024 payroll, made SHIF and the Housing Levy allowable deductions. It also raised the pension cap to KES 30,000/month and the mortgage-interest cap to KES 360,000 p.a., and turned post-retirement medical fund relief into a deduction of up to KES 15,000/month. The Finance Act 2025 now requires employers to apply all of an employee's deductions and reliefs in PAYE, effective 1 July 2025. Ledger Link currently lists these as "unsupported", which is now a compliance gap. A separate Treasury PAYE-relief bill is expected after public participation in October 2026: exemption up to KES 30,000/month and 25% for KES 30,000–50,000. It is not law yet.

### Cited Findings
**TLAA 2024 (effective 27 December 2024)**
- TLAA 2024 came into force on 27 Dec 2024. KRA said the changes apply "in the computation of PAYE for December 2024 and subsequent periods". The Affordable Housing Levy and SHIF contributions became allowable deductions — [KRA Public Notice 2157](https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024)
- SHIF and AHL now reduce **taxable income** rather than tax payable. This replaced the earlier relief of 15% of housing-levy and SHIF contributions — [CDH, Feb 2025](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Practice/Tax-Exchange-Control/tax-exchange-control-alert-21-February-2025-2025-payslip-overhaul-housing-levy-and-shif-become-allowable-deductions-as-nssf-contributions-surge); [Business Daily](https://www.businessdailyafrica.com/bd/economy/treasury-plans-for-salary-tax-cuts-over-shif-housing-levy-4810842)
- The pension/provident/individual retirement fund deduction cap rose from KES 240,000 p.a. (20,000/month) to **KES 360,000 p.a. (30,000/month)** — [Old Mutual](https://www.oldmutual.co.ke/about-us/media-centre/tax-laws-amendment-act-2024-empowering-your-retirement-savings/); [RBA analysis](https://www.rba.go.ke/the-tax-laws-amendment-act-2024-a-detailed-analysis-of-the-amendments-benefiting-the-retirement-benefits-sector/)
- The mortgage-interest deduction rose from KES 300,000 p.a. (25,000/month) to **KES 360,000 p.a. (30,000/month)**, effective December 2024 — [EY](https://globaltaxnews.ey.com/news/2025-0233-kenya-enacts-changes-under-the-tax-laws-amendment-act-2024-and-other-legislation); [PwC Tax Summaries – deductions](https://taxsummaries.pwc.com/kenya/individual/deductions)
- Post-retirement medical fund (PRMF): the old relief of 15% of contributions, capped at KES 60,000 p.a., was repealed. Contributions are now **deductible up to KES 15,000/month** — [Old Mutual](https://www.oldmutual.co.ke/about-us/media-centre/tax-laws-amendment-act-2024-empowering-your-retirement-savings/); [Bowmans](https://bowmanslaw.com/insights/kenya-the-president-assents-the-tax-laws-amendment-bill-and-the-tax-procedures-amendment-bill-2024-into-law/)

**Finance Act 2025 (commencement 1 July 2025 unless stated)**
- The Act was signed on 27 June 2025, commencing 1 July 2025 unless stated otherwise — [UHY Kenya](https://uhy-ke.com/2025/12/23/finance-act-2025-key-tax-changes-kenya/); [EY](https://taxnews.ey.com/news/2025-1498-kenya-enacts-finance-act-2025). (I could not confirm the assent date independently.)
- New PAYE obligation: "an employer shall, before computing the tax deductible…, grant an employee all applicable deductions, reliefs and exemptions provided under this Act". Reported as automatic PAYE relief from 1 July 2025 — [payroll.org](https://payroll.org/news-resources/news/news-detail/2025/05/12/kenya-mandates-automatic-paye-tax-relief-starting-1-july-2025); [CDH on Finance Bill 2025](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Practice/Tax-Exchange-Control/tax-and-excahnge-control-alert-5-may-Unpacking-the-Kenya-Finance-Bill-2025-Whats-changing)
- The **Bill** proposed raising the tax-free per diem from KES 2,000 to KES 10,000 (per day) from 1 July 2025 — [CDH](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Practice/Tax-Exchange-Control/tax-and-excahnge-control-alert-5-may-Unpacking-the-Kenya-Finance-Bill-2025-Whats-changing). The source describes it as a Bill proposal; I could not confirm that it was enacted unchanged.

**Finance Bill / Act 2026**
- A Finance Bill 2026-stage proposal reported these annual bands: 10% to KES 360,000; 17.5% on the next 100,000; 25% from 460,000 to 6,072,000; 27.5% on the next 3,600,000; 30% above 9,600,000. It was proposed to take effect 1 Jan 2027 — [Kenyans.co.ke](https://www.kenyans.co.ke/news/124431-new-paye-tax-bands-set-debate-parliament-ahead-finance-bill-2026-vote). *The reported figures do not add up: 6,072,000 + 3,600,000 = 9,672,000, not 9,600,000.*
- MPs rejected lobbying by ICPAK and the Kenya Bankers Association to cut the top PAYE rate for FY 2026/27 — [Streamlinefeed](https://streamlinefeed.co.ke/news/finance-bill-2026-mps-reject-push-to-lower-paye-income-taxes); [Citizen Digital](https://citizen.digital/article/bankers-accountants-push-for-lower-paye-rates-in-finance-bill-2026-proposals-n383183)
- **The Finance Act 2026 does not amend the PAYE bands, personal income-tax rates or personal reliefs** — [EY, Kenya enacts Finance Act 2026](https://www.ey.com/en_gl/technical/tax-alerts/kenya-enacts-finance-act-2026) (per search summary)
- Assent date conflict: 23 June 2026 ([EY GTNews](https://globaltaxnews.ey.com/news/2026-1445-kenya-enacts-finance-act-2026); [Eastleigh Voice](https://eastleighvoice.co.ke/infographics/371764/finance-act-2026-key-tax-proposals-dropped)) versus 24 June 2026 ([CRS News Flash](https://www.crs.co.za/crs-news-flash-3-july-2026-kenya-finance-act-2026/)) versus 26 June 2026 ([PwC alert](https://www.pwc.com/ke/en/assets/pdf/tax-alert-finance-act-2026.pdf) / [KPMG](https://assets.kpmg.com/content/dam/kpmgsites/ke/pdf/thought_leaderships/tax/2026/Finance-Act-2026_KPMG-Analysis.pdf) per search summary). Measures take effect 1 July 2026 or 1 January 2027 unless stated otherwise — [EY GTNews](https://globaltaxnews.ey.com/news/2026-1445-kenya-enacts-finance-act-2026)
- The Finance Act 2026 introduces **pre-populated income tax returns** in the ITA — [The Star, 1 Jul 2026](https://www.the-star.co.ke/news/2026-07-01-finance-act-2026-measures-take-effect-today)
- **Individual return deadline moved** to the end of the 4th month after year-end (30 April for calendar-year filers), from the end of the 6th month (30 June) — [PwC](https://www.pwc.com/ke/en/assets/pdf/tax-alert-finance-act-2026.pdf) / [KPMG](https://assets.kpmg.com/content/dam/kpmgsites/ke/pdf/thought_leaderships/tax/2026/Finance-Act-2026_KPMG-Analysis.pdf) (search summary); [People Daily, "KRA April 30 deadline"](https://peopledaily.digital/business/kra-april-30-deadline-how-new-tax-rule-will-affect-salaries)

**Pending PAYE relief bill (not law as of 1 Oct 2026)**
- Treasury CS Mbadi moved public participation on PAYE relief to the **first week of October 2026**. The proposals will then become a **Tax Laws (Amendment) Bill** — [Kenyans.co.ke](https://www.kenyans.co.ke/news/127103-treasury-delays-paye-relief-bill-again-sets-october-timeline); [Nairobi Wire](https://nairobiwire.com/2026/09/mbadi-paye-tax-relief-public-participation-october-2026.html)
- The proposal: employees earning **≤ KES 30,000/month exempt from PAYE**, and **KES 30,000–50,000 taxed at 25%**. It affects more than 3.4 million workers — [People Daily](https://peopledaily.digital/business/paye-relief-delayed-to-october-how-ksh30000-ksh50000-salaries-could-change); [Kenyans.co.ke](https://www.kenyans.co.ke/news/127103-treasury-delays-paye-relief-bill-again-sets-october-timeline)

### Inferences
- **Current PAYE table is correct.** The code's `PAYE_BANDS_FINANCE_ACT_2023` (monthly 24,000 / 32,333 / 500,000 / 800,000 at 10 / 25 / 30 / 32.5 / 35%) and the KES 2,400 personal relief remain in force as of Oct 2026, because the Finance Act 2026 did not amend them.
- **Must fix (legal obligation since 1 Jul 2025).** Pension above NSSF (cap KES 30,000/month, combined with NSSF), mortgage interest (KES 30,000/month), PRMF (KES 15,000/month), insurance relief and disability exemption are still in `UNSUPPORTED_EMPLOYEE_ADJUSTMENTS`. The Finance Act 2025 makes the *employer* responsible for applying them. Add per-employee "relief/deduction certificates" with amounts, evidence and validity dates, and feed them into the calculation.
- **Effective dating should key on pay period, not pay date.** KRA applied TLAA 2024 to "December 2024 and subsequent periods", but the code's first table starts on pay date 2024-12-27. Likewise, NSSF Year 4 applies to February 2026 earnings. A January 2026 payroll paid on 2 February 2026 would wrongly pick up Year 4 limits under pay-date lookup.
- **Future-proofing.** Expect a new PAYE band table (possibly 1 Jan 2027 or later) from the pending Tax Laws (Amendment) Bill. The rate-table design should allow non-uniform band counts and possibly a zero-rate band in place of personal relief. Do not hard-code "five bands plus relief".
- **Annual return support.** The P9 and employee summaries should be ready by the earlier individual deadline (30 April) once it applies. Confirm the first year of income affected.

### Gaps
- **[BACKGROUND – VERIFY]** Insurance relief: 15% of qualifying life, education and health premiums, capped at KES 5,000/month (KES 60,000 p.a.). TLAA 2024 is believed to have removed only the AHL/SHIF relief. I found no source this session.
- **[BACKGROUND – VERIFY]** The KES 30,000 pension cap is believed to include NSSF contributions, with a further limit of 30% of pensionable pay. Unconfirmed this session.
- **[BACKGROUND – VERIFY]** Persons with disability: the first KES 150,000/month is exempt with an exemption certificate. Unconfirmed.
- Whether the KES 10,000 per diem and any other Finance Act 2025 PAYE items (for example, reliefs for gratuity or the employment-income exemption list) were enacted as proposed. Fetching the Act text failed.
- Which year of income the 30 April individual deadline first applies to (likely year of income 2026, filed by 30 Apr 2027). Not confirmed.
- The exact bands in any Tax Laws (Amendment) Bill 2026 after October public participation. Not yet published.

---

## 2. NSSF Act 2013 phase-in: Year 3 (Feb 2025) and Year 4 (Feb 2026)

### Takeaway
From February 2026 (Year 4, running to January 2027) the Tier II Upper Earnings Limit is **KES 108,000** (up from 72,000) and the LEL is **KES 9,000**. The rate stays at 6% employee plus 6% employer. The maximum is KES 540 Tier I plus KES 5,940 Tier II, so KES 6,480 each. Ledger Link's tables for Year 2, 3 and 4 match. Year 5 (Feb 2027) is the next scheduled change and is not yet coded.

### Cited Findings
- Year 4 effective February 2026: Tier II UEL **KES 108,000** (from 72,000 in 2025). The 12-month period runs Feb 2026–Jan 2027. The rate is unchanged at **6% employee + 6% employer** — [Workpay](https://www.myworkpay.com/blogs/nssf-2026-phase-4-implementation); [Flexi Personnel](https://www.flexi-personnel.com/new-nssf-rates-feb-2026/); [PAYE Calculator](https://www.payecalculator.co.ke/blog/the-complete-guide-to-nssf-contributions-in-kenya)
- Maximum Tier II pensionable earnings are KES 99,000 (108,000 − 9,000), so the **maximum Tier II contribution is KES 5,940 each** for the employee and employer — [same sources](https://www.payecalculator.co.ke/blog/the-complete-guide-to-nssf-contributions-in-kenya)
- Year 3 (Feb 2025–Jan 2026) UEL was KES 72,000 — [Flexi Personnel](https://www.flexi-personnel.com/new-nssf-rates-feb-2026/)

### Inferences
- Year 4 Tier I = 6% × 9,000 = **KES 540**. Total maximum = **KES 6,480 employee + 6,480 employer**. Year 3: Tier I 480 + Tier II 3,840 = KES 4,320 each (using the LEL of 8,000 in the code).
- The employer's 6% match is a payroll expense plus a liability. The payroll journal batch must post employer NSSF separately from the employee deduction. The same applies to the employer AHL.
- NSSF is well within the KES 30,000 pension deduction cap, so other registered-pension contributions can use the remaining headroom (30,000 − NSSF). This needs the per-employee pension input noted in Q1.

### Gaps
- **[BACKGROUND – VERIFY]** Year 5 (from Feb 2027) limits under the NSSF Act Third Schedule are believed to tie the LEL to the average statutory minimum wage and the UEL to a multiple of National Average Earnings. The UEL has gone 18,000 → 36,000 → 72,000 → 108,000, which is 0.5×, 1×, 2× and 3× a NAE of 36,000. If that pattern holds, Year 5 UEL would be about 4× = KES 144,000. This is a **projection, not a source**; wait for the NSSF gazette or notice, expected around Jan 2027.
- **[BACKGROUND – VERIFY]** NSSF remittance is due by the 9th of the following month, with a 5% monthly penalty on late contributions. Not re-confirmed this session.
- **[BACKGROUND – VERIFY]** Tier II contracting-out to an approved private scheme (RBA-registered) is still allowed. The product should support "Tier II contracted out", where only Tier I goes to NSSF. Not confirmed this session.
- **[BACKGROUND – VERIFY]** The Year 3 LEL of KES 8,000 is taken from the existing code, not from a source found this session.

---

## 3. SHIF (Social Health Insurance Act 2023): rate, minimum, deductibility, SHA vs SHIF, deadline, channels

### Takeaway
SHIF is **2.75% of gross salary**, with a **minimum of KES 300/month** and **no cap**. It is **employee-only** (no employer match) and must be remitted **by the 9th of the following month**. It has been an allowable deduction for PAYE since 27 Dec 2024. The *fund* is SHIF and the *authority* is SHA, so the UI label "SHA deduction" is technically imprecise.

### Cited Findings
- SHIF replaced NHIF in late 2024. It is deducted at **2.75% of gross salary**, with a **minimum monthly deduction of KES 300** and **no upper cap** — [Outsource Accelerator](https://www.outsourceaccelerator.com/articles/kenya-statutory-deductions/); [Employsome](https://employsome.com/hire/kenya/shif/)
- Employers must remit SHIF **by the 9th of the following month** — [Outsource Accelerator](https://www.outsourceaccelerator.com/articles/kenya-statutory-deductions/); [AnooreHR](https://anoorehr.com/blog/kenya-payroll-guide-2026)
- Penalties for non-remittance include a 2% penalty, forced payment of the full annual amount, and fines up to KES 2 million, 3 years' imprisonment, or both — [Outsource Accelerator](https://www.outsourceaccelerator.com/articles/kenya-statutory-deductions/) (secondary source)
- SHIF is managed by the **Social Health Authority (SHA)**. It is an employee-only contribution with no employer portion — [Outsource Accelerator](https://www.outsourceaccelerator.com/articles/kenya-statutory-deductions/)
- SHIF has been an allowable deduction for PAYE from 27 Dec 2024 (December 2024 payroll onward) — [KRA Public Notice 2157](https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024)

### Inferences
- **Label fix.** Rename the payslip and report line from "SHA" to "SHIF" (or "SHIF (SHA)"). The statutory contribution is to the Social Health Insurance Fund, administered by SHA. Keep "SHA" only for the remittance destination or portal.
- The code applies the KES 300 minimum even on very low gross pay, so SHIF can exceed 2.75%. That matches the cited rule, but it needs a net-pay floor check (net cannot go negative).
- SHIF should not get an employer-cost journal line, unlike NSSF and AHL.

### Gaps
- **[BACKGROUND – VERIFY]** SHA payment channels: the SHA employer portal for the monthly by-product (employee list), and payment by M-Pesa paybill **222222** and bank. Not confirmed this session.
- **[BACKGROUND – VERIFY]** SHIF started on 1 Oct 2024, under the Social Health Insurance Act 2023 and the Social Health Insurance (General) Regulations 2024. Not re-confirmed.
- The exact statutory text of the employer penalty (per month, or once) and whether SHA accepts a file upload format (CSV/Excel template). No primary source was reachable.

---

## 4. Affordable Housing Levy (AHL)

### Takeaway
AHL is **1.5% employee + 1.5% employer** on gross salary (1.5% of gross income for the self-employed). It is filed and paid on **iTax** in the P10 return (**sheet M**). It is due by the **9th working day after the end of the month**, with a penalty of **3% per month** unpaid. The deduction began on 19 March 2024 and has been PAYE-deductible since 27 Dec 2024.

### Cited Findings
- Rate 1.5% of an employee's gross salary, with a **matching employer contribution**. Persons in business pay 1.5% of gross income — [KPMG AHL alert](https://assets.kpmg.com/content/dam/kpmg/ke/pdf/tax/2024/KPMG%20Tax%20Alert%20-%20The%20Affordable%20Housing%20Act%202024.pdf); [Grant Thornton](https://www.grantthornton.co.ke/globalassets/1.-member-firms/kenya/insights/pdf/tax-alert-issue-no.4-of-2024---the-affordable-housing-act-2024.pdf)
- Due **by the ninth working day after the end of the month** in which the salary accrued. Filed and paid through **iTax**, declared in the monthly PAYE return **(P10) under sheet M** (Affordable Housing Levy details) — [KPMG](https://assets.kpmg.com/content/dam/kpmg/ke/pdf/tax/2024/KPMG%20Tax%20Alert%20-%20The%20Affordable%20Housing%20Act%202024.pdf); [Lexology](https://www.lexology.com/library/detail.aspx?g=abba5e66-8abd-4557-87a8-518147fd97cc)
- Penalty of **3% of the unpaid amount for each month** unpaid, recoverable as a civil debt from the employer — [Grant Thornton](https://www.grantthornton.co.ke/globalassets/1.-member-firms/kenya/insights/pdf/tax-alert-issue-no.4-of-2024---the-affordable-housing-act-2024.pdf)
- Levy provisions effective **19 March 2024** — [The Star](https://www.the-star.co.ke/siasa/2024-03-21-kra-employers-to-deduct-housing-levy-from-march-19); [KPMG](https://kpmg.com/ke/en/home/insights/2024/03/the-affordable-housing-act-2024.html)
- Allowable deduction for PAYE since 27 Dec 2024 — [KRA Public Notice 2157](https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024)

### Inferences
- **Calendar fix.** "Ninth working day" requires Kenyan public holidays, which the code does not have yet (`statutory.ts` excludes them). Ship a holiday table that is effective-dated, includes gazetted ad-hoc holidays, and can be edited by an admin.
- The employer 1.5% is an employer expense. The payroll journal batch needs Dr Housing Levy expense / Cr AHL payable (3% total liability).
- The P10 export must include sheet M. If the product generates the P10, AHL is not a separate file.

### Gaps
- Whether KRA treats a ninth working day that falls on a holiday differently, and how iTax computes it. No primary text was reachable.
- Boma Yangu's role after the iTax collection change; any Affordable Housing (Amendment) changes in 2025–2026. Not searched (budget exhausted).

---

## 5. NITA levy, HELB and other payroll items

### Takeaway
I found no sources this session. All items below are background knowledge to verify before implementing.

### Cited Findings
- None found in this session (search budget exhausted).

### Inferences
- These are low-complexity employer obligations that payroll competitors typically support. Add them as configurable per-organisation statutory items with their own effective-dated rates and due-date rules.

### Gaps
- **[BACKGROUND – VERIFY]** NITA (Industrial Training Levy): **KES 50 per employee per month**, employer-paid, not deducted from the employee. Paid via the NITA portal or eCitizen by the **9th of the following month**.
- **[BACKGROUND – VERIFY]** HELB loan deductions: the employer deducts the amount HELB notifies and must remit **within 15 days** of deduction (HELB Act s.16). A late-remittance penalty applies (believed to be 5% per month). Employers must also notify HELB when a loanee is hired or leaves.
- **[BACKGROUND – VERIFY]** PAYE penalties: late payment 5% of tax due plus late interest 1% per month. Late filing of the PAYE return: 25% of tax due or KES 10,000, whichever is higher.
- **[BACKGROUND – VERIFY]** P9 forms must be issued to employees by the end of February each year. Casual employees, directors' fees and fringe benefits (car benefit, low-interest loan benefit at the market rate KRA publishes quarterly) each have specific P10 columns.

---

## 6. Business taxes: WHT, WHVAT, TOT, VAT, presumptive, DAT, SEP, minimum tax, rental income, excise

### Takeaway
Resident WHT is **5%** on management and professional fees, **3%** on contractual fees and **10%** on rent. Non-resident WHT is **20%** on services and **30%** on rent. Residential rental income collected by appointed agents is **7.5%**. The **Finance Act 2026 adds WHT of 1.5% on scrap metal and 20% on betting winnings**, plus a final WHT on non-resident rent. **WHVAT is 2%** and **VAT is 16%**. KRA's TOT page shows **TOT at 1.5%**; the upper turnover threshold is reported as KES 25M. The **digital asset tax was dropped in the Finance Act 2025** in favour of a 10% excise on VASP fees (sources conflict). **SEP tax (3%) replaced DST** in Dec 2024, and the Finance Act 2026 widened it. The **VAT registration threshold is disputed** (KES 5M statutory versus some claims of KES 8M) and must be verified.

### Cited Findings
**Withholding income tax**
- Residents: management and professional fees **5%**, contractual fees **3%**, rent on immovable property **10%**. Non-residents: management, professional, training and contractual fees and payments to digital content creators **20%**, rent on immovable property **30%** — [FNJ & Associates](https://fnjassociates.co.ke/withholding-tax-in-kenya/); [Afrotools 2026](https://afrotools.com/blog/kenya-withholding-tax-2026/); [KRA WHT guide (PDF)](https://www.kra.go.ke/images/publications/Withholding-Income-Tax_8112023.pdf)
- **7.5%** WHT on residential rental income collected by agents the Commissioner appoints, effective 1 Jan 2024, residents only — [FNJ & Associates](https://fnjassociates.co.ke/withholding-tax-in-kenya/)
- **Finance Act 2026 (from 1 July 2026):** new WHT of **1.5% on payments for scrap metal** and **20% on gambling and betting winnings**. A new final WHT on **non-residents' rental income: 30% on gross rent from immovable property, 15% on movable property**. The non-resident (PE) corporate rate fell from 37.5% to 30% — [CRS News Flash](https://www.crs.co.za/crs-news-flash-3-july-2026-kenya-finance-act-2026/); [Kenyans.co.ke](https://www.kenyans.co.ke/news/124864-workers-landlords-and-gamblers-face-new-tax-rules-finance-act-2026-takes-effect); [RegFollower](https://regfollower.com/kenya-president-assents-finance-act-2026-introduces-reduced-cit/)
- **Finance Act 2025:** a withholding agent who fails to withhold is not liable for the principal tax where the payee has paid and accounted for it — [CDH](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Practice/Tax-Exchange-Control/tax-and-excahnge-control-alert-5-may-Unpacking-the-Kenya-Finance-Bill-2025-Whats-changing) (stated as a Bill proposal)

**Withholding VAT and VAT**
- WHVAT agents deduct **2%** of the taxable value. Remittance timing **conflicts** between sources: "within 5 days" versus "the 20th of the following month" — [SmartVAT Kenya FAQ](https://smartvatkenya.co.ke/resources/faq/); [Commenda](https://www.commenda.io/kenya/vat-returns) (both low-authority sources)
- VAT registration threshold: the **Finance Bill 2024 proposed raising it from KES 5M to KES 8M** — [CDH](https://www.cliffedekkerhofmeyr.com/news/publications/2024/Practice/Tax/tax-and-exchange-control-alert-14-may-highlights-of-the-finance-bill-2024). That **Bill was withdrawn** after the June 2024 protests — [Wikipedia: Kenya Finance Bill 2024](https://en.wikipedia.org/wiki/Kenya_Finance_Bill_2024). A 2026 secondary site nonetheless claims KES 8M "as of Finance Act 2024, confirmed under Finance Act 2026" — [SmartVAT Kenya](https://smartvatkenya.co.ke/resources/vat-threshold-kenya/). **This claim is suspect, because the Finance Bill 2024 never became an Act.**
- Finance Act 2026 VAT: brings **digital and platform-based financial services** to charge — [PwC/KPMG via search summary](https://www.pwc.com/ke/en/assets/pdf/tax-alert-finance-act-2026.pdf). Sources **conflict** on electric motorcycles, buses and bicycles: "standard-rated" ([PwC/KPMG summary](https://assets.kpmg.com/content/dam/kpmgsites/ke/pdf/thought_leaderships/tax/2026/Finance-Act-2026_KPMG-Analysis.pdf)) versus "VAT exemptions expanded to … specified electric vehicles" ([CRS](https://www.crs.co.za/crs-news-flash-3-july-2026-kenya-finance-act-2026/)). Sugarcane transport from farms to mills became exempt — [CRS](https://www.crs.co.za/crs-news-flash-3-july-2026-kenya-finance-act-2026/)
- Dropped from the Finance Act 2026: tax on mobile phones at activation, a new tax on M-Pesa transfers, excise on bottled water and on locally made plastics, the mitumba exemption, KRA agency notices pending High Court appeals, and ethanol restrictions — [Eastleigh Voice](https://eastleighvoice.co.ke/infographics/371764/finance-act-2026-key-tax-proposals-dropped)

**Turnover tax (TOT)**
- KRA's TOT page states TOT is payable at **1.5% of gross sales**. Its text is internally inconsistent: it attributes the rate to Finance Act 2023 and still shows a KES 50M upper limit, while recent sources show **KES 25M** — [KRA TOT page](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/turnover-tax-tot) (search summary)
- PwC's older entry records TOT **rising from 1% to 3%** for turnover of KES 1M–25M. This is the Finance Act 2023 change — [PwC significant developments](https://taxsummaries.pwc.com/kenya/corporate/significant-developments)
- KRA launched a **daily TOT payment** option for small traders in March 2026 — [Nairobi Wire](https://nairobiwire.com/2026/03/kra-daily-turnover-tax-small-traders.html)

**Digital Asset Tax, SEP, minimum tax**
- DAT was introduced at 3% (Sept 2023). The Finance Bill 2025 proposed halving it to 1.5% — [Citizen Digital](https://www.citizen.digital/article/finance-bill-2025-why-govt-is-halving-digital-assets-tax-on-crypto-nfts-to-15-n362264). MPs then **dropped the DAT** and substituted a **10% excise duty on fees charged by virtual asset service providers** — [Business Daily](https://www.businessdailyafrica.com/bd/economy/mps-drop-digital-assets-tax-of-3pc-on-transactions-5091206); [Orbitax "Kenya Repeals Digital…"](https://orbitax.com/news/country/article/Update---Kenya-Repeals-Digital-59360). One search summary instead said "reduced to 1.5%", which **conflicts**. The weight of sources favours repeal.
- TLAA 2024 **repealed the 1.5% Digital Service Tax and replaced it with SEP tax (effective rate 3%)** from 27 Dec 2024 — [Digital Policy Alert](https://digitalpolicyalert.org/event/34684-government-of-kenya-implemented-the-significant-economic-presence-tax-under-the-tax-laws-amendment-act-2024); [EY](https://taxnews.ey.com/news/2025-0233-kenya-enacts-changes-under-the-tax-laws-amendment-act-2024-and-other-legislation). Draft SEP Tax Regulations were issued in 2025 — [CDH, Oct 2025](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Practice/Tax-Exchange-Control/tax-and-exchange-control-alert-03-october-Kenya-issues-draft-Income-Tax-Significant-Economic-Presence-Tax-Regulations-2025)
- The Finance Act 2026 reportedly **widened SEP to all non-resident digital providers** by removing the KES 5M turnover exemption, and covers digital marketplaces — [Tech-ish, Jul 2026](https://tech-ish.com/2026/07/28/kra-sept-digital-tax-doubled-2026/) (search summary)
- TLAA 2024 introduced a **minimum top-up tax** (15% effective-rate floor for covered groups, in line with Pillar Two) — [KPMG TLAA analysis](https://assets.kpmg.com/content/dam/kpmg/ke/pdf/tax/2024/Tax%20Laws%20(Amendment)%20Act%202024%20Analysis_final.pdf). A search summary said the Act "did not repeal minimum tax". This **conflicts** with my background knowledge that the 1% turnover-based minimum tax (s.12D) was repealed. Verify.

**Tax amnesty and system-error relief (Finance Act 2026)**
- Amnesty window **1 July – 31 Dec 2026**: principal tax debts accrued up to **31 Dec 2025** can be settled by **31 Dec 2026** with penalties and interest waived — [CRS](https://www.crs.co.za/crs-news-flash-3-july-2026-kenya-finance-act-2026/); [PwC/KPMG summary](https://www.pwc.com/ke/en/assets/pdf/tax-alert-finance-act-2026.pdf)
- KRA may **waive penalties and interest up to KES 2 million** where the liability came from an error generated by an electronic tax system — [Lawyers-KE](https://lawyers-ke.com/articles/finance-act-2026-key-tax-changes-every-kenyan-business-must-know/) (search-summary attribution; verify)

### Inferences
- **WHT module (new).** Ledger Link needs WHT on bills and payments, at minimum resident 5% / 3% / 10% and residential-rent 7.5% (agents), plus non-resident rates and the new 1.5% scrap and 20% winnings categories. The withheld portion credits a WHT payable account, and the payee is paid net. Customers' WHT certificates should be tracked as a receivable or credit against corporate tax.
- **WHVAT (receivable side).** The tax summary already shows a 2% WHVAT credit. It should be driven by actual WHVAT certificates per invoice, not a percentage estimate.
- **TOT mode.** Organisations not registered for VAT with turnover of KES 1M–25M need a TOT regime: 1.5% of gross sales monthly, no VAT on invoices, due the 20th. Add a regime flag per organisation (VAT / TOT / income-tax-only) with effective dates.
- **VAT threshold.** Do not hard-code it. Store the threshold as an effective-dated parameter (default KES 5M until verified) and warn when rolling 12-month sales approach it.
- **Do not build** DAT or DST features for Kenyan SMEs. SEP and minimum top-up tax are out of scope for an SME product.

### Gaps
- **[BACKGROUND – VERIFY]** TOT was reduced from 3% to **1.5% by TLAA 2024, effective 27 Dec 2024**. Upper threshold KES 25M (Finance Act 2023, from 1 July 2023), lower threshold KES 1M. TOT due the 20th of the following month. KRA's page confirms 1.5% but I could not confirm the amending Act and date.
- **[BACKGROUND – VERIFY]** WHT remittance was changed by the Finance Act 2023 to **within 5 working days after deduction** (from the 20th). WHVAT also has a 5-working-day remittance. The current code calendar has no WHT deadline.
- **[BACKGROUND – VERIFY]** VAT standard rate 16%. The VAT return and payment are due the **20th of the following month**. VAT on petroleum products is 16% (Finance Act 2023). VAT registration threshold KES 5M per 12 months (VAT Act s.34). The KES 8M claim needs a primary source.
- **[BACKGROUND – VERIFY]** Monthly Rental Income (MRI) tax: 7.5% of gross residential rent for annual rent of KES 288,000–15M (Finance Act 2023), due the 20th of the following month.
- **[BACKGROUND – VERIFY]** Presumptive tax (15% of the business-permit fee) is believed to have been repealed in 2023. Unconfirmed.
- **[BACKGROUND – VERIFY]** Instalment tax is due on the 20th day of the 4th, 6th, 9th and 12th months. Corporate returns are due 6 months after year-end.
- Excise duty rates (annual inflation adjustment and Finance Act 2026 excise changes) were not researched because the budget ran out. They are probably low priority for a general SME ledger.

---

## 7. KRA eTIMS: variants, the deductibility rule, 2025–2026 enforcement, VAT-return linkage, credit notes and reverse invoices

### Takeaway
eTIMS invoices are now the evidence that tax returns are matched against. ITA s.16(1)(c) disallows expenses not supported by eTIMS invoices unless exempt under TPA s.23A. From **1 January 2026**, KRA validates income and expenses in income-tax returns against **eTIMS data, WHT certificates and customs import records** (KRA notice dated 10 Nov 2025). The **VAT return is auto-populated** from eTIMS for sales and from suppliers' eTIMS invoices for purchases. The Finance Act 2025 excluded payments subject to *final* WHT from the eTIMS requirement. For Ledger Link, purchase-side eTIMS capture and verification matter as much as issuing sales invoices.

### Cited Findings
- **ITA s.16(1)(c)** was amended to disallow expenditure where invoices are not generated from an electronic tax invoice management system, unless the transaction is exempt under the TPA — [EY](https://taxnews.ey.com/news/2025-2471-kenya-revenue-authority-to-validate-income-and-expenses-in-income-tax-returns); [MMW Advocates](https://mmw.legal/kra-is-validating-income-and-expenses/)
- **From 1 Jan 2026** KRA validates income and expenses declared in individual and non-individual returns against eTIMS, WHT certificates and customs import records. When 2025 returns are uploaded, claimed expenses and purchases are validated against TIMS/eTIMS purchase invoices — [EY](https://taxnews.ey.com/news/2025-2471-kenya-revenue-authority-to-validate-income-and-expenses-in-income-tax-returns); [KRA iTax Enhancements Dec 2025–Jan 2026 (PDF)](https://www.kra.go.ke/images/publications/iTax-Enhancements--Dec-2025-Jan2026.pdf); [PKF Dec 2025 alert](https://www.pkfea.com/media/wxgnftjw/kenya-tax-alert-etims-2025-dec-02.pdf); [Streamlinefeed](https://streamlinefeed.co.ke/news/kenya-revenue-authority-enforces-etims-validation-rules-starting-january-2026). The KRA public notice is dated **10 Nov 2025** — [InvoiceMonk](https://invoicemonk.com/en/blog/kra-etims-kenya-explained) (secondary source)
- **Validation exemptions** (TPA s.23A and para 10 of the e-invoice regulations): emoluments; imports; investment allowances, including internal accounting adjustments; airline passenger ticketing; interest; fees charged by financial institutions; expenses subject to final WHT; services from non-residents without a PE in Kenya — [KRA iTax Enhancements PDF](https://www.kra.go.ke/images/publications/iTax-Enhancements--Dec-2025-Jan2026.pdf) (search summary)
- **Finance Act 2025** amended TPA s.23A so that payments subject to **final WHT** (payments to non-residents, and qualifying dividends, qualifying interest or winnings paid to residents) are excluded from the e-invoicing requirement — [CDH](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Practice/Tax-Exchange-Control/tax-and-excahnge-control-alert-5-may-Unpacking-the-Kenya-Finance-Bill-2025-Whats-changing)
- **VAT auto-populated return.** KRA pre-populates output VAT from the filer's eTIMS sales and input VAT from **suppliers'** eTIMS submissions and customs import records. If a supplier does not transmit a compliant eTIMS invoice, that purchase is missing and the input VAT claim is effectively blocked — [KRA FAQ: The VAT Auto-Populated Return](https://www.kra.go.ke/helping-tax-payers/faqs/the-vat-auto-populated-return); [Business Today](https://businesstoday.co.ke/inside-the-vat-pre-populated-return-system-kras-simplified-way-of-filing-returns/); [Commenda](https://www.commenda.io/kenya/vat-returns)
- **Verification.** A QR code on each invoice plus the **invoice checker on itax.kra.go.ke** show whether a purchase invoice was generated through TIMS/eTIMS and carries the buyer details needed for an input claim — [search summary of KRA/InvoiceMonk sources](https://invoicemonk.com/en/blog/kra-etims-kenya-explained)
- The Finance Act 2026 lets KRA waive penalties and interest up to KES 2M arising from electronic tax system errors — [Lawyers-KE](https://lawyers-ke.com/articles/finance-act-2026-key-tax-changes-every-kenyan-business-must-know/) (verify)
- KPMG published a 2026 eTIMS paper — [KPMG eTIMS 2026 (PDF)](https://assets.kpmg.com/content/dam/kpmgsites/ke/pdf/thought_leaderships/tax/2026/eTIMS.pdf.coredownload.inline.pdf). Title only; contents not retrievable.

### Inferences
- **Highest-value eTIMS feature: purchase-side compliance.** For each bill, capture the supplier's eTIMS invoice number, CU invoice number or QR, and the date. Mark the bill as "eTIMS-backed", "exempt (reason code from the s.23A list)" or "at risk (non-deductible)". Produce an **"expenses at risk of disallowance"** report and an **input-VAT reconciliation** against the KRA auto-populated return, showing supplier-transmitted versus booked amounts.
- **Exemption reason codes** for bills and journals should mirror the KRA list: emoluments, imports (with customs entry number), interest, bank charges, airline tickets, final-WHT payments, non-resident services, and internal adjustments (depreciation, provisions).
- **Sales-side.** The current "Type C draft that needs the business's own OSCU/VSCU" is the right constraint. Also add a simpler path for very small users: record invoice numbers produced in eTIMS Client or Lite and attach them, so the books stay reconcilable even without system-to-system integration.
- Revenue validation from Jan 2026 means **sales recorded in Ledger Link must match eTIMS sales totals**. Add a monthly "Ledger versus eTIMS sales" reconciliation.

### Gaps
- **[BACKGROUND – VERIFY]** eTIMS solution types:
  - **OSCU** (Online Sales Control Unit): system-to-system, always online, invoice-by-invoice signing, for high-volume ERP/POS.
  - **VSCU** (Virtual Sales Control Unit): system-to-system, for bulk or offline-tolerant invoicing with batch sync.
  - **eTIMS Client**: desktop or online portal.
  - **eTIMS Lite**: web or USSD (*222#), aimed at non-VAT and micro taxpayers.
  - **eTIMS mobile app.**

  Third-party integrators must be **KRA-certified** through the eTIMS developer sandbox (application, sandbox testing, test-case sign-off, then production credentials). Each taxpayer still has to register its own OSCU/VSCU, with device serial and branch ID. **I could not reach any primary source for certification steps, timelines or API specs this session.**
- **[BACKGROUND – VERIFY]** Credit notes must reference the original eTIMS invoice and be transmitted through eTIMS. **Buyer-initiated / reverse invoices** let a buyer generate an eTIMS invoice for purchases from unregistered suppliers, such as farm produce. Whether reverse invoices satisfy s.16(1)(c) for specific supply categories needs KRA guidance.
- **[BACKGROUND – VERIFY]** eTIMS became mandatory for VAT-registered persons from 2023, and was extended to all businesses, including non-VAT-registered, from 1 Jan 2024. Unconfirmed this session.
- Whether a pre-populated *income tax* return (Finance Act 2026) will also pull eTIMS expenses. Likely, but no detail found.

---

## 8. KRA iTax filing formats and KRA APIs (P10, VAT3, WHT certificates, P9, GavaConnect)

### Takeaway
Only partly verified. The P10 return carries **AHL in sheet M**, and VAT returns are **auto-populated** from eTIMS. File-template column specs, VAT3 CSV layouts and GavaConnect API catalogues could not be confirmed this session.

### Cited Findings
- AHL is declared in the monthly PAYE return **Form P10, sheet M** — [KPMG AHL alert](https://assets.kpmg.com/content/dam/kpmg/ke/pdf/tax/2024/KPMG%20Tax%20Alert%20-%20The%20Affordable%20Housing%20Act%202024.pdf)
- The VAT return is auto-populated, so the filer reviews and confirms rather than keying in figures — [KRA FAQ](https://www.kra.go.ke/helping-tax-payers/faqs/the-vat-auto-populated-return); [Business Today](https://businesstoday.co.ke/inside-the-vat-pre-populated-return-system-kras-simplified-way-of-filing-returns/)
- An eTIMS invoice checker is available on itax.kra.go.ke — [InvoiceMonk](https://invoicemonk.com/en/blog/kra-etims-kenya-explained)
- The Finance Act 2026 introduced pre-populated income-tax returns — [The Star](https://www.the-star.co.ke/news/2026-07-01-finance-act-2026-measures-take-effect-today)

### Inferences
- Because VAT is pre-populated, Ledger Link's value is **reconciliation and exception reporting** (what KRA will show versus what the books say), not generating a VAT3 CSV.
- The P10 remains a template-based upload (Excel macro or CSV), so a **P10 export** in KRA's column order is still a high-value payroll feature. It must be versioned, because KRA changes the template when the law changes (for example, sheet M was added in 2024).

### Gaps
- **[BACKGROUND – VERIFY]** The P10 iTax template is an Excel workbook with macros that generates a zipped CSV for upload. Sheets include B (employee details and pay: PIN, residence, employee type, basic, housing, transport and other allowances, non-cash benefits, housing benefit, pension contributions, mortgage interest, insurance relief, taxable pay, PAYE), C (employees with disability), D (casual), E (consultants or others), F (lump sum) and M (AHL). **The exact current column list could not be obtained. Download the live template from iTax before building.**
- **[BACKGROUND – VERIFY]** VAT3 sections (sales to registered and unregistered persons, purchases, WHVAT credits, imports) were historically uploaded as CSV/Excel. They are now largely auto-populated.
- **[BACKGROUND – VERIFY]** WHT certificates are generated by iTax when the agent files and pays the WHT. Payees download them from iTax. P9 is the annual employee tax deduction card, due by end of February.
- **[BACKGROUND – VERIFY]** **GavaConnect** (developer.go.ke) is KRA's API developer portal. It reportedly offers OAuth client-credential APIs including a **PIN checker** (by PIN or by ID), **TCC checker**, **eTIMS invoice checker**, obligation checker, exemption checker, NIL-return filing and e-slip/payment checks. Commercial access needs app registration and approval. No source was reachable this session; check the API list and terms directly.
- Whether iTax accepts any API-based return submission (PAYE or VAT) for third-party software. Not established.

---

## 9. Data protection (DPA 2019, ODPC), Computer Misuse and Cybercrimes Act, record retention

### Takeaway
No sources were reachable this session. These obligations are material for a payroll SaaS hosted on Supabase outside Kenya. All points below are background knowledge to confirm with ODPC and Kenya Law before relying on them.

### Cited Findings
- None found in this session (WebFetch blocked for odpc.go.ke and kenyalaw.org; search budget exhausted).

### Inferences
- Ledger Link is a **data processor** for its customers' payroll and employee data, and a **data controller** for its own users. It needs a Data Processing Agreement template, an ODPC registration assessment, a breach runbook with 72-hour and 48-hour clocks, a DPIA for payroll (financial and possibly health-adjacent data such as SHIF and disability exemptions), and a documented **cross-border transfer basis** for non-Kenyan hosting.
- Payroll data for Kenyan employers is probably not "strategic interest" data that must stay in Kenya, but verify. If it were, Supabase hosting outside Kenya would require at least a serving copy in Kenya.
- Retention defaults should be **7 years** for ledgers and payroll. That covers both the TPA (5 years) and the Companies Act (believed to be 7). Deletion must be blocked within the retention window, even on account closure, with export provided.

### Gaps
- **[BACKGROUND – VERIFY]** **Registration** under the Data Protection (Registration of Data Controllers and Data Processors) Regulations 2021 is mandatory for:
  - controllers and processors with **annual turnover/revenue above KES 5M and more than 10 employees**; and
  - regardless of size, those processing for purposes listed in the Second Schedule (believed to include health, education, financial services, telecoms, property, hospitality, direct marketing, transport and others).

  Registration lasts **24 months**. Fees are tiered at about KES 4,000 (micro/small), 16,000 (medium) and 40,000 (large).
- **[BACKGROUND – VERIFY]** Breach notification: the controller notifies the **ODPC within 72 hours** (DPA s.43) and data subjects without undue delay. A processor notifies the controller **within 48 hours**.
- **[BACKGROUND – VERIFY]** A **DPIA** is required for high-risk processing (DPA s.31). The Data Protection (General) Regulations 2021 list processing types and require consultation with ODPC before high-risk processing.
- **[BACKGROUND – VERIFY]** **Cross-border transfer** (DPA ss.48–50; General Regulations 2021): allowed with proof of appropriate safeguards, an adequacy decision, necessity, or consent for sensitive data. Under s.50 and the regulations, certain processing for "strategic interests of the state" or protection of revenue must use a server or data centre in Kenya, or keep a serving copy in Kenya.
- **[BACKGROUND – VERIFY]** Penalties: administrative fines up to **KES 5M or 1% of the previous year's annual turnover, whichever is lower**.
- **[BACKGROUND – VERIFY]** **Computer Misuse and Cybercrimes Act 2018**: offences for unauthorised access and interference, and a duty to report certain cyber incidents to the National KE-CIRT/CC. An amendment Act was reportedly passed in 2025. Contents unverified.
- **[BACKGROUND – VERIFY]** Record retention: TPA s.23 requires records to be kept **5 years** from the end of the reporting period they relate to. The VAT Act also requires 5 years. The Companies Act 2015 is believed to require accounting records to be kept **7 years**. The Employment Act requires employment records (believed 5 years after employment ends).
- Whether ODPC issued new SaaS/cloud guidance or amendment regulations in 2025–2026. Not searched.

---

## 10. Accounting standards and entity-specific reporting (IFRS for SMEs 3rd ed., ICPAK, NGOs/PBOs, SACCOs, Companies Act)

### Takeaway
No sources were reachable this session. The key date to verify is that the **IFRS for SMEs third edition** (issued in 2025) applies to periods **beginning on or after 1 January 2027**. Its revenue section moves to an IFRS 15-style model, which affects how SME users recognise revenue in FY 2027 statements.

### Cited Findings
- None found in this session (ifrs.org blocked; search budget exhausted).

### Inferences
- For a ledger product, the third edition mainly changes **revenue recognition** (performance obligations, contract assets and liabilities) and some **disclosure templates**. Ledger Link should support contract-liability (deferred revenue) and contract-asset accounts in its chart-of-accounts templates before FY 2027 reporting.
- NGO and SACCO verticals need different report sets: fund or restricted accounting for PBOs, and SASRA prudential returns for SACCOs. They are **separate products** and should be scoped as later add-ons, not core.

### Gaps
- **[BACKGROUND – VERIFY]** The IFRS for SMEs Accounting Standard, third edition, was issued **27 February 2025** and is effective for periods beginning **1 January 2027**, with early application permitted. Main changes:
  - Section 23 revenue rewritten on IFRS 15 principles;
  - control and consolidation aligned with IFRS 10;
  - a new fair value measurement section (IFRS 13);
  - business combination updates (IFRS 3);
  - simplified expected-credit-loss provisions;
  - alignment with the 2018 Conceptual Framework.

  IFRS 16-style leases were **not** introduced.
- **[BACKGROUND – VERIFY]** ICPAK requires full IFRS or IFRS for SMEs for Kenyan general-purpose financial statements. ICPAK has issued guidance or a framework for micro-entities.
- **[BACKGROUND – VERIFY]** The **Public Benefit Organizations Act 2013** commenced in **May 2024**, replacing the NGO Coordination Act. The PBO Regulatory Authority requires annual returns and audited financial statements. NGOs typically need fund, grant and donor-restricted accounting.
- **[BACKGROUND – VERIFY]** **SACCOs**: deposit-taking and specified non-withdrawable SACCOs are regulated by **SASRA** under the Sacco Societies Act 2008 and its regulations, with prescribed monthly, quarterly and annual returns (capital adequacy, liquidity, risk classification of loans). Other cooperatives report to the Commissioner for Cooperative Development.
- **[BACKGROUND – VERIFY]** **Companies Act 2015**: annual returns are filed with the Business Registration Service on eCitizen, within 30 days after the anniversary of incorporation. The beneficial-ownership register must be filed and updated within the statutory window. Small companies may claim audit exemption under statutory thresholds; exact thresholds unverified.

---

## 11. East Africa scoping: Uganda (EFRIS), Tanzania (VFD/EFD), Rwanda (EBM), EAC

### Takeaway
No sources were reachable this session. Each EAC market has its own **mandatory real-time fiscal invoicing system**: URA EFRIS, TRA EFD/VFD and RRA EBM. Each also has its own payroll statutory regime, and there is no EAC-level harmonisation of e-invoicing or payroll. Regional expansion means a new country pack (rate tables, calendar, e-invoicing adapter, file exports) per country.

### Cited Findings
- None found in this session.

### Inferences
- Architecturally, Ledger Link should generalise its Kenyan design before expanding. That means a `country` dimension on rate tables, statutory calendars and e-invoice adapters, which keeps Kenya clean today and makes Uganda, Tanzania and Rwanda pluggable.
- Uganda is probably the nearest next market, given its maturity and published API. All three require per-taxpayer device or credential registration, similar to Kenya's OSCU/VSCU constraint.

### Gaps
- **[BACKGROUND – VERIFY] Uganda:**
  - **EFRIS** (URA) e-invoicing/e-receipting is mandatory for VAT-registered taxpayers and progressively extended. Integration is through a system-to-system API or EFD devices.
  - VAT 18%.
  - Resident monthly PAYE: UGX 0–235,000 at 0%; 235,001–335,000 at 10%; 335,001–410,000 at 20%; above 410,000 at 30%; an extra 10% on income above UGX 10M/month.
  - NSSF Uganda: 5% employee + 10% employer.
  - PAYE and NSSF due the 15th of the following month.
  - Local Service Tax applies.
- **[BACKGROUND – VERIFY] Tanzania:**
  - TRA **EFD/VFD** (Virtual Fiscal Device) fiscal receipting is mandatory, with e-receipt verification.
  - VAT 18%.
  - Monthly PAYE: TZS 0–270,000 at 0%; 270,001–520,000 at 8%; 520,001–760,000 at TZS 20,000 + 20%; 760,001–1,000,000 at TZS 68,000 + 25%; above 1M at TZS 128,000 + 30%.
  - SDL about 3.5% (employer).
  - WCF 0.5% (employer).
  - NSSF 10% + 10%.
  - PAYE and SDL due the 7th of the following month.
- **[BACKGROUND – VERIFY] Rwanda:**
  - RRA **EBM** (Electronic Billing Machine) v2, including software EBM/VSDC integration.
  - VAT 18%.
  - Monthly PAYE: RWF 0–60,000 at 0%; 60,001–100,000 at 10%; 100,001–200,000 at 20%; above 200,000 at 30%.
  - RSSB pension contribution raised from 2025 (believed 6% + 6%, stepping up toward 20% by 2030), plus maternity 0.6% and CBHI 0.5%.
- **[BACKGROUND – VERIFY] EAC:** the EAC Customs Union and Common Market harmonise customs (EACCMA and the Common External Tariff), but not domestic VAT, income tax, payroll or e-invoicing. The EAC Double Tax Agreement has not been fully ratified.
- All East Africa rates above may have changed through 2025/26 Finance Acts, which in Uganda and Tanzania take effect each 1 July. **Do not code any of them without primary-source confirmation.**

---

## 12. Upcoming changes and the effective-dated rate tables Ledger Link should hold (synthesis)

### Takeaway
As of 1 Oct 2026 Ledger Link's coded PAYE, NSSF, SHIF and AHL rates are current. The next known or likely changes are:
- a **Tax Laws (Amendment) Bill on PAYE relief** (public participation in October 2026; possible effect from 1 Jan 2027);
- **NSSF Year 5 limits in Feb 2027**;
- the **30 April individual-return deadline** under the Finance Act 2026;
- the Finance Act 2026's new **WHT categories** and **amnesty ending 31 Dec 2026**;
- **IFRS for SMEs 3rd edition for periods from 1 Jan 2027**;
- continuing **eTIMS-based return validation**, which has applied since 1 Jan 2026.

### Cited Findings
- PAYE relief bill, with public participation in early October 2026 — [Kenyans.co.ke](https://www.kenyans.co.ke/news/127103-treasury-delays-paye-relief-bill-again-sets-october-timeline); [People Daily](https://peopledaily.digital/business/paye-relief-delayed-to-october-how-ksh30000-ksh50000-salaries-could-change)
- Finance Act 2026 effective dates of 1 July 2026 / 1 Jan 2027 — [EY GTNews](https://globaltaxnews.ey.com/news/2026-1445-kenya-enacts-finance-act-2026)
- NSSF Year 4 runs Feb 2026–Jan 2027 — [Workpay](https://www.myworkpay.com/blogs/nssf-2026-phase-4-implementation)
- Tax amnesty to 31 Dec 2026 — [CRS](https://www.crs.co.za/crs-news-flash-3-july-2026-kenya-finance-act-2026/)
- eTIMS validation in effect since 1 Jan 2026 — [EY](https://taxnews.ey.com/news/2025-2471-kenya-revenue-authority-to-validate-income-and-expenses-in-income-tax-returns)
- Individual return deadline at the end of the 4th month — [People Daily](https://peopledaily.digital/business/kra-april-30-deadline-how-new-tax-rule-will-affect-salaries)

### Inferences
**Current-state table** (values in force on 1 Oct 2026; ✔ = cited this session, ✱ = background, verify):

| Item | Value | Effective | Status |
|---|---|---|---|
| PAYE monthly bands | 0–24,000 at 10%; 24,001–32,333 at 25%; 32,334–500,000 at 30%; 500,001–800,000 at 32.5%; >800,000 at 35% | 1 Jul 2023 (FA 2023); unchanged by FA 2025/FA 2026 | ✔ unchanged (EY); band values ✱ (match code) |
| Personal relief | KES 2,400/month | FA 2023 | ✱ (unchanged per EY) |
| Insurance relief | 15% of premiums, max 5,000/month | — | ✱ |
| SHIF and AHL | Deductible from taxable pay | Dec 2024 payroll (27 Dec 2024) | ✔ |
| Pension deduction cap | KES 30,000/month | 27 Dec 2024 | ✔ |
| Mortgage interest | KES 30,000/month (360k p.a.) | 27 Dec 2024 | ✔ |
| PRMF deduction | KES 15,000/month | 27 Dec 2024 | ✔ |
| Employer must apply all reliefs | Obligation | 1 Jul 2025 | ✔ |
| NSSF | 6% + 6%; LEL 9,000; UEL 108,000; max 6,480 each | Feb 2026–Jan 2027 | ✔ (LEL ✔ derived) |
| SHIF | 2.75% gross, min 300, no cap, employee only; due 9th | Oct 2024 ✱ | ✔ |
| AHL | 1.5% + 1.5%; due 9th working day; P10 sheet M; 3%/month penalty | 19 Mar 2024 | ✔ |
| NITA | KES 50/employee/month (employer) | — | ✱ |
| VAT | 16%; return due 20th; threshold KES 5M (disputed 8M) | — | ✱ / conflict |
| WHVAT | 2% | — | ✔ rate; timing conflict |
| WHT residents | Professional/management 5%; contractual 3%; rent 10%; residential rent via agents 7.5% | 7.5% from 1 Jan 2024 | ✔ |
| WHT new (FA 2026) | Scrap metal 1.5%; betting winnings 20%; non-resident rent 30% immovable / 15% movable (final) | 1 Jul 2026 | ✔ |
| TOT | 1.5% of gross sales; KES 1M–25M | ✱ (TLAA 2024?) | ✔ rate (KRA page) |
| DAT | Repealed in FA 2025; 10% excise on VASP fees | 1 Jul 2025 | ✔ (conflict noted) |
| SEP | 3% effective; widened in FA 2026 | 27 Dec 2024; 1 Jul 2026 | ✔ |
| Individual return deadline | End of 4th month (30 Apr) | FA 2026 (first year to verify) | ✔ |

**Rate-table and engine design implications**
1. Key tables on **pay period** (YYYY-MM), not pay date.
2. Support **any number of bands** and an optional zero band.
3. Model **employer-side items** (NSSF employer, AHL employer, NITA) as separate lines in the **atomic payroll journal batch**.
4. Add **per-employee relief certificates** (insurance, mortgage, PRMF, extra pension, disability exemption) with validity dates.
5. Add a **regime per organisation** (VAT / TOT / none) with effective dates.
6. Add **WHT and WHVAT tax codes** on bills and invoices.
7. Add an **eTIMS evidence field and exemption reason** on every expense.
8. Add a **public-holiday table** for working-day deadlines.

**Statutory calendar fixes**
1. Add WHT (✱ 5 working days after deduction), WHVAT (✱ 5 working days), TOT (20th ✱), MRI (20th ✱), instalment tax (20th of months 4, 6, 9 and 12 ✱), NITA (9th ✱), HELB (15 days ✱), annual corporate return (6 months after year-end ✱), individual return (30 April, FA 2026 ✔), and ODPC registration renewal (24 months ✱).
2. Verify the **weekend and holiday roll rule**. The product owner's rule moves deadlines to the next working day. The general rule in the Interpretation and General Provisions Act is believed to extend a deadline that falls on a holiday or Sunday. KRA practice is often stated as "file and pay before the due date", and some KRA guidance is believed to say the *previous* working day. **This is unresolved and could make Ledger Link show a deadline one or more days late.** Highest-priority item to verify with KRA.

**Watch-list for Q4 2026 – 2027**
- PAYE Tax Laws (Amendment) Bill 2026: watch for band changes from about 1 Jan 2027.
- NSSF Year 5 gazette notice, around Jan 2027.
- KRA notices on pre-populated income-tax returns (FA 2026).
- KRA eTIMS and income-tax validation tightening.
- Finance Bill 2027, published around April–May 2027, with an Act effective 1 July 2027.
- Possible SHIF rate or regulation amendments.
- ODPC regulation updates.
- IFRS for SMEs 3rd edition adoption, from 1 Jan 2027.

### Gaps
- Primary-source confirmation (Kenya Law Acts text, KRA notices) for every ✱ item above. The egress proxy blocked all primary sites during this session, so a follow-up pass with network access to kra.go.ke, kenyalaw.org, odpc.go.ke and ifrs.org is strongly recommended before coding any ✱ value.
- Uganda, Tanzania and Rwanda figures are entirely unverified (see Q11).
