# Payroll and close handoff

## Done

- Package 0: root agent rules and test commands. Commit `543306aa9c70896ef4ec9cf9086f9d84fdb4c18b`. No tests added. `npm run lint` passed; `npm test` passed, 201 tests. Database and integration suites not run: this Windows host has no local Postgres 16 command, and WSL is unavailable.
- Package 1: seeded three effective-dated statutory rate versions, locked used versions, loaded the effective database version for posting and preview, and added a payroll-gated GET route. Commit `ae0929faf45406198a5df0db6947d2f99dd266d2`. Added one unit seed/equivalence test, one SQL immutability and access test, and one integration service test. `npm run lint` passed; `npm test` passed, 202 tests. SQL and integration tests were not run because local Postgres 16 is unavailable.

## In progress

- Package 2 source review is complete, but no package 2 code has been added. Package 1 SQL and integration tests still need execution on local Postgres 16.
- The branch builds with `npm run build`; `npm run lint` and `npm test` were rerun after the source review and passed, with 202 unit tests.

## Next

- Run `npm run test:db` and `npm run test:integration` on a host with local Postgres 16. Review the package 1 migration result before production use.
- Package 2: add a new migration for dated employee adjustment records and an `EMPLOYEE` attachment type. Store caps and rates as dated, sourced, unverified child rows keyed by statutory rate version. Existing versions may already be used, so do not update their locked parent rows. Extend the pure calculator, the payroll SQL function in a new migration, payroll services and routes, and the employee UI. Save applied record IDs and amounts on each payslip. Employee attachments need payroll-only routes: the current generic attachment download route could otherwise expose them to a read-only member.
- Then continue packages 3 through 7 in the task order. Code `2150` appears unused and is a candidate for Net Salaries Payable; confirm against all charts before using it. Package 4 must retain the existing OFX import and save only CSV mappings.

## Open questions and unverified figures

- Pension cap including NSSF, KES 30,000 monthly: [KRA simplified PAYE guide](https://www.kra.go.ke/images/publications/STEP-BY-STEP-GUIDE-FOR-THE-SIMPLIFIED-PAYE-RETURN.pdf), page 2. This resolves the interaction the roadmap left open. Keep the figure marked unverified when seeded, as the task requires for roadmap figures.
- Mortgage interest KES 30,000 monthly and post-retirement medical fund contribution KES 15,000 monthly: [KRA public notice, 19 December 2024](https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024). Keep both marked unverified when seeded.
- Insurance relief 15 percent, up to KES 5,000 monthly: [KRA simplified PAYE guide](https://www.kra.go.ke/images/publications/STEP-BY-STEP-GUIDE-FOR-THE-SIMPLIFIED-PAYE-RETURN.pdf), page 2, and [KRA individual income tax page](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/individual-income-tax). Keep both rate and cap marked unverified when seeded.
- Disability income exemption, first KES 150,000 monthly with a valid certificate: [KRA public notice, 11 March 2024](https://www.kra.go.ke/news-center/public-notices/2095-income-tax-exemption-for-persons-with-disability). Keep the figure marked unverified when seeded. Open question: confirm the exact interaction of the exempt income with other deductions and personal relief before writing the calculation.
- Deadline roll rule and the later NSSF upper limit: no confirmed primary source found in the roadmap research.

## Deviations

- Existing payroll runs can have the `legacy-unversioned` marker, so package 1 does not add a foreign key from payroll runs to the three-row rate table. The used-version trigger still prevents edits and deletion.
- The statutory rate table is shared reference data, so its read policy is global for signed-in users. The Worker route remains behind organization authentication and `requirePayrollAccess`.
