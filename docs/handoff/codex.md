# Payroll and close handoff

## Done

- Package 0: root agent rules and test commands. Commit `543306aa9c70896ef4ec9cf9086f9d84fdb4c18b`. No tests added. `npm run lint` passed; `npm test` passed, 201 tests. Database and integration suites not run: this Windows host has no local Postgres 16 command, and WSL is unavailable.
- Package 1: seeded three effective-dated statutory rate versions, locked used versions, loaded the effective database version for posting and preview, and added a payroll-gated GET route. Commit `ae0929faf45406198a5df0db6947d2f99dd266d2`. Added one unit seed/equivalence test, one SQL immutability and access test, and one integration service test. `npm run lint` passed; `npm test` passed, 202 tests. SQL and integration tests were not run because local Postgres 16 is unavailable.
- Package 2: employee evidence records, sourced unverified relief rules linked to each rate version, a pure calculation with dated evidence and shared caps, atomic payslip snapshots, employee evidence UI, and payroll access checks for employee files. Commit `a1004b5e4933c1a37926954dcccddd7ba1d82fff`. Added six unit tests, a SQL suite and service/API integration coverage. `npm run lint` passed; `npm test` passed, 208 tests. Database and integration suites remain unrun because local Postgres 16 is unavailable.
- Package 3: account `2165` Net Salaries Payable added to the standard chart and backfilled for existing organizations. New pay runs credit it while earlier runs retain their cash posting. A separate dated payment debits payable and credits bank, and its own reversal uses a reversing entry. Salary payment UI, SQL tests and integration tests added. Commit: this package commit, titled `Accrue net salaries and record separate bank payments`. `npm run lint` passed; `npm test` passed, 208 tests. SQL and integration suites were not run because this Windows host lacks local Postgres 16.

## In progress

- SQL and integration checks for packages 1 through 3 need local Postgres 16.
- Corrected package 1 rate selection to use the pay date in the Worker and preview, as requested. Earlier code used the month earned.

## Next

- Run `npm run test:db` and `npm run test:integration` on a host with local Postgres 16. Review the package 1 migration result before production use.
- Package 4: save and prefill CSV statement column mappings per organization and money account. Retain existing OFX import. Then continue packages 5 through 7 in order.

## Open questions and unverified figures

- Pension cap including NSSF, KES 30,000 monthly: [KRA simplified PAYE guide](https://www.kra.go.ke/images/publications/STEP-BY-STEP-GUIDE-FOR-THE-SIMPLIFIED-PAYE-RETURN.pdf), page 2. This resolves the interaction the roadmap left open. Keep the figure marked unverified when seeded, as the task requires for roadmap figures.
- Mortgage interest KES 30,000 monthly and post-retirement medical fund contribution KES 15,000 monthly: [KRA public notice, 19 December 2024](https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024). Keep both marked unverified when seeded.
- Insurance relief 15 percent, up to KES 5,000 monthly: [KRA simplified PAYE guide](https://www.kra.go.ke/images/publications/STEP-BY-STEP-GUIDE-FOR-THE-SIMPLIFIED-PAYE-RETURN.pdf), page 2, and [KRA individual income tax page](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/individual-income-tax). Keep both rate and cap marked unverified when seeded.
- Disability income exemption, first KES 150,000 monthly with a valid certificate: [KRA public notice, 11 March 2024](https://www.kra.go.ke/news-center/public-notices/2095-income-tax-exemption-for-persons-with-disability). The calculator subtracts the exempt amount from chargeable income before applying bands and personal relief, with a zero floor. The rule is marked unverified, as are the other roadmap figures.
- Deadline roll rule and the later NSSF upper limit: no confirmed primary source found in the roadmap research.

## Deviations

- Existing payroll runs can have the `legacy-unversioned` marker, so package 1 does not add a foreign key from payroll runs to the three-row rate table. The used-version trigger still prevents edits and deletion.
- The statutory rate table is shared reference data, so its read policy is global for signed-in users. The Worker route remains behind organization authentication and `requirePayrollAccess`.
- Package 2 records tax evidence for amounts paid outside the pay run; it does not add payroll cash withholding or remittance liabilities for those amounts. The employee form states this. Additional pension deductions share the monthly ceiling with NSSF.
- Package 3 uses account code `2165` because `2150` already holds withholding tax and `2160` holds tips and service charge. The payroll RPC keeps its original `p_cash_account_id` parameter name for compatibility, but new calls pass the `2165` account. Existing custom `2165` accounts are left intact by the backfill and will have to be an active liability in the base currency before a new run can post.
