# Negative testing: what is mocked and what is real

PayPal's `PayPal-Mock-Response` header is honoured **only** by Orders v2 and Payments v2
([negative-testing request headers](https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/)).
Vigil enforces that boundary in code: `packages/paypal/src/mock-response.ts` holds a typed
allowlist, and the HTTP client refuses to send the header on any other operation before the
request leaves the process (tested in `packages/paypal/test/contracts.test.ts`).

## Mocked with `PayPal-Mock-Response` (real PayPal behaviour, forced error)

| Flow       | Operations                                           | Example codes                                                                 | What happens in Vigil                                                                                                                                   |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E3 capture | `POST /v2/payments/authorizations/{id}/capture`      | `AUTHORIZATION_EXPIRED`, `MAX_CAPTURE_AMOUNT_EXCEEDED`, `PREVIOUSLY_CAPTURED` | 422 → execution `FAILED_FINAL` with `debug_id` on the settlement trail; `PREVIOUSLY_CAPTURED` after a lost response → `NEEDS_RECONCILE` → a GET decides |
| Void       | `POST …/authorizations/{id}/void`                    | `AUTHORIZATION_VOIDED`, `PREVIOUSLY_CAPTURED`                                 | final error, exception `FAILED`                                                                                                                         |
| E4 refund  | `POST /v2/payments/captures/{id}/refund`             | `REFUND_AMOUNT_EXCEEDED`, `TRANSACTION_DISPUTED`                              | final error; policy R4/R8 normally block these first                                                                                                    |
| Reads      | authorization / capture / refund GET, order GET      | any allowlisted code                                                          | surfaced as typed errors                                                                                                                                |
| Seeding    | `POST /v2/checkout/orders`, `/authorize`, `/capture` | `TRANSACTION_REFUSED`, `PAYER_ACTION_REQUIRED`                                | seeder records the refusal                                                                                                                              |

`reauthorize` is **not** in the allowlist: the negative-testing page doesn't list it.

## Real invalid-state calls (no mocks exist)

| API                                                         | How we exercise failures                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Subscriptions v1 (`capture` outstanding balance, `suspend`) | call against a subscription with no balance / already suspended     |
| Orders v2 `track`                                           | tracking on a capture that isn't valid → `CAPTURE_STATUS_NOT_VALID` |
| Invoicing, Disputes, Tracking v1, Transaction Search        | real responses only                                                 |

These errors flow through the same error mapper (`packages/paypal/src/errors.ts`) as mocked ones.

## Vigil's own fault injection (labelled synthetic)

Transport faults (a 503 before or after PayPal commits, a lost response, a network error) are
simulated **in tests** with a stateful fake of the PayPal API that honours `PayPal-Request-Id`
(`apps/workflows/src/testing/fake-paypal.ts`). The integration tests prove:

- a forced 503 is retried with the **same** `PayPal-Request-Id` → one PayPal effect;
- a lost response (PayPal committed, Vigil saw 503) → PayPal replays the original result → one effect;
- retries exhausted → `NEEDS_RECONCILE` → a GET decides, never a blind retry;
- double approval (two tabs, concurrent) → one execution.

Vigil never claims to mock Subscriptions, Invoicing, Tracking or Disputes failures.
