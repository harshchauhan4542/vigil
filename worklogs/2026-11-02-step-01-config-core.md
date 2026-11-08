# 2026-11-02 — Step 01: Config and core domain

**Session goal:** the shared vocabulary every other package uses.
**Result:** ✅ Done
**Branch / commit:** `step-01-config-core`

## What was done

- `@vigil/config`: Zod env loaders `loadWebEnv`, `loadWorkflowsEnv`, `loadPayPalLiveEnv`, `loadSeedEnv`, `loadDbEnv`. Empty string = unset; live mode requires PayPal and Anthropic keys; secrets ≥ 32 chars; errors list every bad key and never echo values.
- `@vigil/core/money.ts`: integer minor units + currency, strict decimal parse (rejects extra precision), PayPal amount conversion, currency-mismatch errors, `multiplyRatio` with explicit rounding (BigInt math).
- `@vigil/core/enums.ts`: exception types E1–E5, action types, `ALLOWED_ACTIONS` per exception (R1), risk tiers, all statuses, open proposal states.
- `@vigil/core/state-machines.ts`: proposal, execution, exception and webhook-event machines with `assertTransition`.
- `@vigil/core/schemas.ts`: strict Zod schemas for every action's params, proposal meta (`evidence_refs`, `rationale ≤ 600`, `confidence`), discriminated `ProposedAction`, `targetRefOf`.
- `@vigil/core/canonical.ts`: `canonicalJson`, `sha256Hex`, `paramsHash`.

## Checks

| Check                           | Result                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| lint / typecheck / test / build | ✅ (core 383 tests incl. every from→to pair of every machine; config 9)                        |
| Step "Done when" checks         | ✅ `"0.10"+"0.20"`, rounding, currency mismatch, all transitions, key-order-independent hashes |

## Decisions and deviations from the plan

- Exception machine adds the back-edges the plan describes in prose (re-triage after policy/human rejection or a final PayPal error; re-open after RESOLVED/DISMISSED).
- Webhook `FAILED` may retry into `PROCESSED`/`IGNORED_DUPLICATE`/`FAILED` (plan: "FAILED (retryable)").

## Left over / next

- Next: Step 2, Database layer and audit log.

## Needs from the user

- Nothing.
