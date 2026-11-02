# 2026-11-02 — Step 03: PayPal client foundation

**Session goal:** one safe, reusable way to talk to PayPal.
**Result:** 🟡 Code done, live smoke pending keys
**Branch / commit:** `step-03-paypal-client`

## What was done

- `cache.ts`: `KvCache` with `MemoryCache` and `RedisCache` (ioredis, `SET NX PX` lock + owner-checked release).
- `token.ts`: client-credentials OAuth, cached under `pp:token:{client_id}`, refreshed 5 min before expiry, single-flight in-process and across processes via a cache lock; OAuth error shape mapped to `PayPalAuthError`.
- `http.ts`: typed fetch client (Bearer, JSON, `Prefer: return=representation`, `PayPal-Request-Id`), one retry on 401 with a fresh token, optional retries on 429/5xx/network that reuse the same request id, redacted debug logging.
- `errors.ts`: `PayPalApiError` (`status`, `name`, `debug_id` from body or header, `details[].issue`, `kind`, `retryable`), `PayPalNetworkError`, issue-code → kind table.
- `idempotency.ts`: `paypalRequestId = uuidv5(business_key + ":" + operation)`, per-operation retention windows, `canRetryWithSameId`.
- `sdk.ts`: `@paypal/paypal-server-sdk` client sharing Vigil's token through `oAuthTokenProvider`.
- `logger.ts`: pino + header/body redaction. `client.ts`: `createPayPalClient()`.
- `scripts/src/paypal-smoke.ts` → `pnpm paypal:smoke`.
- 🧪 Spike S1 written up in `docs/spikes.md`.

## Checks

| Check                                                                     | Result                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| lint / typecheck / test / build                                           | ✅ (paypal: 34 MSW tests)                                                                                   |
| MSW: token cache/refresh, 401 retry, error table, retry reuses request id | ✅                                                                                                          |
| `pnpm paypal:smoke` (live)                                                | ⏳ not run: no `.env` yet. It currently exits with "PAYPAL_CLIENT_ID is missing / PAYPAL_SECRET is missing" |

## Decisions and deviations from the plan

- Spike S1: the SDK supports both headers (Orders/Payments) and a token-provider hook. Vigil still routes its own calls through `http.ts` (single transport for logging, errors and Step 8 replay); the SDK shares the token cache.
- Payments v2 retention kept at a conservative 6 h although the SDK docs say 45 days.

## Left over / next

- Run `pnpm paypal:smoke` once the sandbox keys are in `.env`.
- Next: Step 4.

## Needs from the user

- PayPal sandbox app Client ID + Secret in `vigil/.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`).
