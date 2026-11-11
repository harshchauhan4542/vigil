# 2026-11-02 — Step 17: Remaining widgets, audit and judge pages

**Result:** 🟡 Built and route-tested; needs a browser click-through by you
**Branch:** `step-17-widgets`

## What was done

- **W1 Money-at-Risk** tiles (`/api/stats`: open money at risk vs. recovered in 7 days, per currency).
- **W2 Deadline Radar**: next 6 deadlines with colour by urgency (overdue / ≤ 12 h / later).
- **W4 Settlement Trail** (`/api/exceptions/[id]/trail`): every audit row for the exception and its proposals with actor, time, sequence and hash prefix.
- **`/audit`**: AG Grid over the audit log with the hash-chain verification badge.
- **`/judge`**: mode switch, "Reset demo data" (Live only, rate-limited), the sandbox buyer login (from `PAYPAL_SANDBOX_PERSONAL_*`, sandbox-only), and a "things to try" list.
- **"Simulate PayPal failure"** on the Proposal Card, shown only for capture / void / refund (Orders v2 / Payments v2). The gate validates the code and action (`mock_not_supported` otherwise) and passes it to `execute_proposal`, which sends `PayPal-Mock-Response` and records `mock_code` on the execution.
- Theme additions (tiles, radar, badges); nav links to `/audit` and `/judge`.

## Checks

| Check                                                                                          | Result                                                      |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| lint / typecheck / test / build                                                                | ✅ (web 9)                                                  |
| Stats, trail, mock toggle (422 recorded with mock code), mock refused on a non-mockable action | ✅                                                          |
| Full demo click-through without a terminal                                                     | ⏳ needs data (keys or Step 19 demo fixtures) and a browser |

## Decisions

- W1/W2/W3/W4 are React components beside Studio rather than Studio custom widgets; Studio keeps the analytics panel. Converting them into Studio widgets with a frozen `initial-report.ts` stays open (needs browser iteration with the licence).
