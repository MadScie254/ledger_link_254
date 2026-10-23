# Kundi feature handoff

Branch: `codex/church-features`, based on `origin/main` at `02ffe2b`.

## Done in this branch

- Member giving statements with a date filter, plus a PDF receipt for each posted gift.
- Fund budgets for annual income targets and expense limits, compared with posted fund results.
- Campaigns and member pledges tied to existing funds. Campaign and pledge progress comes from posted gifts in the campaign period. A pledge does not post money.
- Monthly giving plans compared with posted member gifts. A plan does not collect or post money.
- M-Pesa exception summary and reason filters on the existing waiting queue.
- Service-to-deposit review on cash counts: counted, banked and matched-to-statement states, plus variances.
- Council pack PDF for a selected month, with the monthly result, restricted funds, budgets through that month, money accounts and items needing review.
- Fund project report for a selected date range, with posted movement and income and expenses by account, plus PDF export.

## In progress

- Remaining requested features: split gifts, spending requests, attendance and visitor follow-up, and multi-campus reporting.

## Next

1. Finish the local database and integration suites for this first slice, then commit it.
2. Build spending requests and their approval trail, with no posting until an expense is recorded through the existing ledger workflow.
3. Design split gifts as one atomic posting so the ledger and fund reports agree.

## Open questions

- Campus model: one church ledger with campus tags or separate books. The user has been asked; no answer has arrived. Shared ledger is the current working assumption.
- Campaign progress attributes all gifts from a member to the campaign's fund during its dates. A gift is not explicitly linked to a pledge. Campaigns for the same fund cannot overlap.

## Deployment

- No changes have been pushed or deployed from this branch.
- Payroll PR #11 remains separate. Its production migration order is unresolved, so it has not been merged.
