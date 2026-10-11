# Payroll and close handoff

## Done

- Package 0: root agent rules and test commands. Commit `543306aa9c70896ef4ec9cf9086f9d84fdb4c18b`. No tests added. `npm run lint` passed; `npm test` passed, 201 tests. Database and integration suites not run: this Windows host has no local Postgres 16 command, and WSL is unavailable.
- Package 1: seeded three effective-dated statutory rate versions, locked used versions, loaded the effective database version for posting and preview, and added a payroll-gated GET route. Commit `ae0929faf45406198a5df0db6947d2f99dd266d2`. Added one unit seed/equivalence test, one SQL immutability and access test, and one integration service test. `npm run lint` passed; `npm test` passed, 202 tests. SQL and integration tests were not run because local Postgres 16 is unavailable.
- Package 2: employee evidence records, sourced unverified relief rules linked to each rate version, a pure calculation with dated evidence and shared caps, atomic payslip snapshots, employee evidence UI, and payroll access checks for employee files. Commit: this package commit, titled `Add dated employee relief evidence and payslip snapshots`. Added six unit tests, a SQL suite and service/API integration coverage. `npm run lint` passed; `npm test` passed, 208 tests. Database and integration suites remain unrun because local Postgres 16 is unavailable.

## In progress

- Package 3 has not started. SQL and integration checks for packages 1 and 2 need local Postgres 16.
- Corrected package 1 rate selection to use the pay date in the Worker and preview, as requested. Earlier code used the month earned.

## Next

- Run `npm run test:db` and `npm run test:integration` on a host with local Postgres 16. Review the package 1 migration result before production use.
- Package 3: confirm code `2150` is unused across all charts, add Net Salaries Payable, update the payroll function in a new migration, and add atomic salary payments and their own reversals. Then continue packages 4 through 7 in order. Package 4 must retain the existing OFX import and save only CSV mappings.

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
