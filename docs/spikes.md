# Spikes

Quick experiments that decide between Plan A and Plan B. One section per spike.

## S1 (Step 3): can `@paypal/paypal-server-sdk` 2.5.0 send `PayPal-Request-Id` and `PayPal-Mock-Response`?

**Method:** read the generated controllers (2026-11-02), then proved it with an MSW test (`packages/paypal/test/sdk.test.ts`): `captureAuthorizedPayment` sends both headers and the token from Vigil's cache.

**Findings**

| Controller                                                                                          | `paypalRequestId`                        | `paypalMockResponse`                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Orders (`createOrder`, `authorizeOrder`, `captureOrder`)                                            | ✅ ("server stores keys for 6 hours")    | ✅                                                          |
| Payments (`captureAuthorizedPayment`, `reauthorizePayment`, `voidPayment`, `refundCapturedPayment`) | ✅ (SDK docs: "stores keys for 45 days") | ✅ on capture/void/get/refund; not on reauthorize           |
| Subscriptions (`createSubscription`, `captureSubscription`, `createBillingPlan`)                    | ✅ ("72 hours")                          | ❌ (matches PayPal: mocks are Orders v2 / Payments v2 only) |
| Orders tracking, subscription suspend                                                               | ❌ (no header in the spec)               | ❌                                                          |

The SDK also accepts `clientCredentialsAuthCredentials.oAuthTokenProvider`, so it can share Vigil's cached token instead of fetching its own.

**Decision: Plan A, with one transport.** The SDK _can_ do everything we need, but Vigil sends all of its own PayPal calls through `packages/paypal/src/http.ts` so that token refresh, the error mapper, secret redaction and (Step 8) the record/replay transport sit in exactly one place. `sdk.ts` builds a configured SDK `Client` that shares the token cache (`oAuthTokenProvider`) for typed access where convenient (scripts, Transaction Search).

**Retention windows used** (`idempotency.ts`): Orders 6 h, Payments 6 h (conservative; the SDK says 45 days), Subscriptions/Plans/Products 72 h; Tracking and suspend have no header, so `(operation, business_key)` in `idempotency_keys` plus a check-before-act GET provide idempotency.
