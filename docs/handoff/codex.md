# Payroll and close handoff

## Done

- Package 0: root agent rules and test commands. Commit `543306aa9c70896ef4ec9cf9086f9d84fdb4c18b`. No tests added. `npm run lint` passed; `npm test` passed, 201 tests. Database and integration suites not run: this Windows host has no local Postgres 16 command, and WSL is unavailable.
- Package 1: seeded three effective-dated statutory rate versions, locked used versions, loaded the effective database version for posting and preview, and added a payroll-gated GET route. Commit: the commit containing this package entry (`git log -1 --format=%H` after commit). Added one unit seed/equivalence test, one SQL immutability and access test, and one integration service test. `npm run lint` passed; `npm test` passed, 202 tests. SQL and integration tests were not run because local Postgres 16 is unavailable.

## In progress

- Package 2 has not started. Package 1 SQL and integration tests still need execution on local Postgres 16.

## Next

- Run `npm run test:db` and `npm run test:integration` on a host with local Postgres 16. Then begin package 2 by verifying primary sources for relief caps, followed by dated employee evidence records.

## Open questions and unverified figures

- Additional pension, mortgage, and post-retirement medical fund caps: secondary [Old Mutual commentary](https://www.oldmutual.co.ke/about-us/media-centre/tax-laws-amendment-act-2024-empowering-your-retirement-savings/) is cited by the roadmap, but primary statutory text and interaction with NSSF are unverified.
- Insurance relief and disability exemption amounts: no source found in the roadmap research.
- Deadline roll rule and the later NSSF upper limit: no confirmed primary source found in the roadmap research.

## Deviations

- Existing payroll runs can have the `legacy-unversioned` marker, so package 1 does not add a foreign key from payroll runs to the three-row rate table. The used-version trigger still prevents edits and deletion.
- The statutory rate table is shared reference data, so its read policy is global for signed-in users. The Worker route remains behind organization authentication and `requirePayrollAccess`.
