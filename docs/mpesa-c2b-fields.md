# M-Pesa C2B confirmation fields

What Kundi reads from Safaricom's C2B confirmation callback, where that comes
from, and what is still to be checked before telling a church that gifts will
post on their own.

## Status: not yet checked in the Daraja sandbox

The sandbox check the build plan asks for has **not** been done. The session
that built this (8 October 2026) could not reach `sandbox.safaricom.co.ke` or
`developer.safaricom.co.ke` from its network, and has no Daraja app keys.
Everything below comes from the published Daraja C2B samples and from
third-party SDK documentation that mirrors them. Treat it as the expected
shape, not a confirmed one.

**Before promising automatic posting to any church:**

1. Create an app on the Daraja portal with the C2B product and note the
   sandbox shortcode (600xxx) and the consumer key and secret.
2. In Ledger Link, as an owner or admin of a test church: Settings,
   Integrations. Enter the shortcode, choose Sandbox, paste the key and
   secret, name who M-Pesa giving posts in the name of, and press
   "Register URLs with Safaricom". The app must be served over a public
   address (set `PUBLIC_API_ORIGIN` if the Worker sits behind another host).
3. Use the Daraja simulator (C2B simulate) to pay the shortcode with account
   reference `1043`, then `BLD`, then something that matches no rule.
4. Read the receipts in Giving, Queue (or `public.mpesa_receipts.raw`, which
   keeps the body exactly as Safaricom sent it) and fill in the table below.
5. Commit the filled-in table here.

| Field | Expected | Seen in the sandbox |
| --- | --- | --- |
| `TransactionType` | `Pay Bill` or `Buy Goods` | not yet checked |
| `TransID` | 10-character M-Pesa code, e.g. `SJK3H2K9QX` | not yet checked |
| `TransTime` | `yyyyMMddHHmmss`, East Africa Time | not yet checked |
| `TransAmount` | `"1500.00"` (a string) | not yet checked |
| `BusinessShortCode` | the paybill, or for a till the store number | not yet checked |
| `BillRefNumber` | the account reference the giver typed | not yet checked |
| `InvoiceNumber` | usually empty | not yet checked |
| `OrgAccountBalance` | the paybill balance, or empty | not yet checked |
| `ThirdPartyTransID` | usually empty | not yet checked |
| `MSISDN` | **masked**, e.g. `2547 ***** 126` | not yet checked |
| `FirstName`, `MiddleName`, `LastName` | the payer's names as registered; often only the first | not yet checked |

## What the code relies on

`src/utils/mpesaC2b.ts` (`parseC2bConfirmation`) needs three fields and
refuses the callback without them:

- `TransID`: kept upper case as `mpesa_receipts.trans_id`. A receipt is kept
  once per church per code, so a repeated callback changes nothing.
- `TransTime`: read as Nairobi time (`+03:00`).
- `TransAmount`: a positive amount with at most two decimals, kept in cents.

Matching (`src/utils/givingRules.ts`) reads **only `BillRefNumber`**. The
phone number is kept as sent but never used to find a member, because
Safaricom masks it. If the sandbox shows `BillRefNumber` arriving empty or
altered (for example for Buy Goods tills, which have no account reference),
those gifts will all wait in the queue: say so to the church before they
choose a till over a paybill.

The names are joined into `first_name` and shown to the treasurer as a hint
in the queue.

## What Ledger Link answers

- Validation URL: always `{"ResultCode": "0", "ResultDesc": "Accepted"}`.
  Kundi takes every gift; validation only runs if Safaricom has enabled
  external validation for the shortcode.
- Confirmation URL: the receipt is stored first, then
  `{"ResultCode": "0", "ResultDesc": "Accepted"}` is returned, then matching
  and posting run. An unknown token gets HTTP 404, an unreadable body 400.

## URLs and tokens

- Registered URLs are `/api/public/giving/c2b/<token>/confirmation` and
  `/validation`. Daraja's published guidance refuses URLs containing words
  such as M-Pesa, Safaricom, exe, cmd, SQL or query, so the registered path
  says "giving". The Worker also answers on `/api/public/mpesa/c2b/<token>/...`.
- The token is 32 random bytes (64 hex characters). Only its SHA-256 is
  stored (`org_integrations.callback_token_hash`); the Worker hashes the
  token in the URL and compares in constant time.
- A new token is made on every registration. It replaces the old one only
  when Safaricom accepts the URLs. "Make URLs to register by hand" replaces it
  at once, for churches whose bank or Safaricom registers the URLs for them.
- Register URL uses `ResponseType: "Completed"`, so a payment completes if
  the validation URL cannot be reached.
- Safaricom does not sign callbacks. Anyone holding the token could send a
  false receipt; it would post as giving and show up as a difference when the
  M-Pesa statement is reconciled. To narrow this, set `MPESA_CALLBACK_IPS` on
  the Worker to Safaricom's published callback addresses (comma separated);
  callers from any other address are refused. Get the current list from
  Safaricom rather than from memory.

## Still to confirm with Safaricom

- Whether production uses `/mpesa/c2b/v1/registerurl` or a newer version.
  The code calls v1 (`REGISTER_PATH` in `src/server/mpesaC2b.ts`).
- That production registration is one time per shortcode, as the published
  guidance says, and how a church changes its URLs afterwards.
- The masking pattern of `MSISDN` (it varies between samples).
