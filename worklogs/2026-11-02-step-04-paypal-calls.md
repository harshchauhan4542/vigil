# 2026-11-02 — Step 04: PayPal reads, actions and mock responses

**Session goal:** every PayPal call Vigil needs, split into read-only and money-moving files.
**Result:** 🟡 Code done, live smoke pending keys
**Branch / commit:** `step-04-paypal-calls`

## What was done

- `reads.ts`: order, authorization, capture, refund, subscription (+ transactions), Transaction Search (31-day windows × all pages, async generator), trackers, invoices, disputes.
- `actions.ts` (subpath `@vigil/paypal/actions`): capture / reauthorize / void authorization, refund capture, add tracking, capture subscription outstanding balance, suspend subscription. Calls with a declared header **require** `requestId`.
- `sandbox-setup.ts` (subpath `@vigil/paypal/sandbox-setup`): create product, plan, subscription, order (PayPal or card source), authorize order, capture order. For the seeder only.
- `mock-response.ts`: typed allowlist of Orders v2 / Payments v2 operations and known mock codes; `http.ts` refuses the header on any other operation before sending.
- `types.ts`: minimal resource shapes with spec field names.
- ESLint: new `SANDBOX_SETUP` boundary (allowed in `scripts/` and `apps/workflows` only); `scripts/` may no longer import `actions`. Boundary tests: 23.
- `pnpm paypal:smoke` now also creates and reads one CAPTURE order.

## Checks

| Check                                      | Result                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| lint / typecheck / test / build            | ✅ (paypal: 58 MSW tests)                                               |
| MSW contract test per call                 | ✅ method, path, spec body fields, `PayPal-Request-Id`, `Prefer` header |
| Lint: `actions` only from `apps/workflows` | ✅ (boundary tests)                                                     |
| Live: create + read one order              | ⏳ needs sandbox keys in `.env` (`pnpm paypal:smoke`)                   |

## Decisions and deviations from the plan

- Demo-data creation calls live in a separate `sandbox-setup.ts` rather than `actions.ts`, so the seeder never needs the money-moving module.
- `reauthorize` is not in the mock allowlist (PayPal's negative-testing page lists authorization get, capture, void only).
- `track` body fields (`capture_id`, `tracking_number`, `carrier`, `notify_payer`) still marked [U] in the plan; confirm on the first live call.

## Left over / next

- Live smoke once keys are present.
- Next: Step 5, Sandbox seeder.

## Needs from the user

- Same as Step 3: sandbox Client ID + Secret in `.env`.
