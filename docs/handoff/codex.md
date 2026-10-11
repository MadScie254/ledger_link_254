# Payroll and close handoff

## Done

- Package 0: root agent rules and test commands added. Commit: `git log -1 --format=%H` on this branch identifies the package commit. No tests added. `npm run lint` passed; `npm test` passed, 201 tests. Database and integration suites were not run: this Windows host has no local Postgres 16 command, and WSL is unavailable.

## In progress

- Package 1 has not started.

## Next

- Add effective dated statutory rate versions in a new migration, then wire the Worker and preview to the database version and test the seed, immutability, and payslip equivalence.

## Open questions and unverified figures

- Additional pension, mortgage, and post-retirement medical fund caps: secondary [Old Mutual commentary](https://www.oldmutual.co.ke/about-us/media-centre/tax-laws-amendment-act-2024-empowering-your-retirement-savings/) is cited by the roadmap, but primary statutory text and interaction with NSSF are unverified.
- Insurance relief and disability exemption amounts: no source found in the roadmap research.
- Deadline roll rule and the later NSSF upper limit: no confirmed primary source found in the roadmap research.

## Deviations

- None yet.
