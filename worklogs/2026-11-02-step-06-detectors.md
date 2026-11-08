# 2026-11-02 — Step 06: Detectors (E3, E4)

**Session goal:** turn mirrored PayPal data into a prioritized list of exceptions.
**Result:** ✅ Done
**Branch / commit:** `step-06-detectors`

## What was done

- `packages/detectors` (pure, imports only `@vigil/core`):
  - `e3-auth-honor.ts`: `CREATED`/`PARTIALLY_CAPTURED` authorization ≥ 60 h old (honor end − 12 h) or within 24 h of `expiration_time`. Deadline = honor end while it lasts, then validity end. Amount at risk = authorized − captured.
  - `e4-unmatched.ts`: one-to-one matching of PayPal gross and fee items to ledger rows on currency + amount + reference (`invoice_id` / `custom_id` / transaction id) + date ±2 days. Reasons: `missing_in_books`, `fee_missing_in_books`, `amount_mismatch` (paired into one exception), `missing_in_paypal`, `duplicate_in_books`.
  - `score.ts`: urgency 1–4 from hours to deadline; score = money at risk × urgency; `byPriority` sort.
  - `detectAll()`.
- `packages/db/src/mirror.ts`: upserts for authorization/capture/order/subscription/transaction mirrors, window queries, `markLedgerMatched`, `knownAuthorizationIds` / `knownCaptureIds` (mirror + seeder). New `exceptions.score` column (migration `0003`); `listExceptions` sorts by score.
- `apps/workflows` package created. `src/sync/detect.ts` = `detect_exceptions` logic: sync known authorizations (404s skipped), Transaction Search window → mirror, run detectors, upsert exceptions, mark matched ledger rows. `src/sync/mappers.ts` converts PayPal money to cents once.
- `apps/workflows/test/fake-paypal.ts`: stateful fake PayPal (idempotent by `PayPal-Request-Id`, failure injection) reused in later steps.

## Checks

| Check                           | Result                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| lint / typecheck / test / build | ✅ (detectors 29, workflows 3)                                                                      |
| Step "Done when" checks         | ✅ 59h59m vs 60h, ±2-day boundaries (2 matches, 3 doesn't), duplicate refund (both seeded variants) |

## Decisions and deviations from the plan

- Authorizations can't be listed from PayPal, so the sweep refreshes ids Vigil already knows (mirror + seeder; webhooks add more in Step 11).
- Ledger rows newer than 3 h (Transaction Search lag) and within 2 days of the window start are not judged, to avoid false "missing in PayPal".
- A wrong booked amount produces **one** `amount_mismatch` exception (on the PayPal item, citing the ledger row), not two.

## Left over / next

- Next: Step 7, Policy engine and approval tokens.

## Needs from the user

- Request the AG Studio trial (today).
