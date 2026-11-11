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

## S2 (Step 5): how do seeded orders get buyer approval?

**Problem:** an AUTHORIZE or CAPTURE order normally needs the buyer to log in and approve it in a browser before `/authorize` or `/capture` works. Subscriptions need the same.

**Options built into `pnpm seed` (both covered by tests in `scripts/test/seed.test.ts`):**

1. **Plan A: card payment source (single-step, default).** `POST /v2/checkout/orders` with `payment_source.card` (sandbox test Visa from `SEED_CARD_NUMBER`, default `4111111111111111`) and a `PayPal-Request-Id` (mandatory for single-step orders per SPEC-ORD). If PayPal completes the payment inline, the seeder stores the authorization/capture id straight away; if it returns `APPROVED`, the seeder calls `/authorize` or `/capture`.
2. **Plan B: pre-approved pool.** With `--no-card` (or if a card order comes back `PAYER_ACTION_REQUIRED`), the seeder stores the order with its `payer-action` link and prints it. The user approves it with the sandbox Personal account; the next `pnpm seed` sees `APPROVED` and authorizes/captures it. The nightly reseed (Step 14) does the same top-up.

**Subscriptions** always use Plan B (approve link), since sandbox card-direct subscriptions are not verified [U].

**Status:** ⏳ **not yet verified live** (no sandbox keys yet). First live run decides: if card orders are refused (e.g. the sandbox business account lacks advanced card processing), fall back to Plan B. Record the result here.

**Hold ages:** the sandbox cannot backdate an authorization, so honor-period ages come from time passing: run `pnpm seed --cohort` daily (nightly job later) to add a dated cohort, so some holds are near the 72 h honor limit on demo day.

## S3 (Step 13): AG Studio custom runner and model adapter — Plan A or Plan B?

**Method:** read the `ag-studio` / `ag-studio-react` 3.0.0 type definitions (2026-11-02).

**Findings**

- `ag-studio-react` exports `AgStudioProvider` (`licenseKey`, `modules`), `AgStudio` (props = `AgStudioProperties`: `data: { sources: [...] }`, `mode: 'view' | 'edit'`, `initialState`, `widgets`, `ai`, `theme`, …), `createWidgets`, `GridWidget`, `PivotGridWidget`.
- Custom widgets: `AgWidgetDefinition { id, label, icon, dataMapping, form(params), defaultState, comp }` registered through `createWidgets({ additionalTypes, menu })`.
- AI: `createAiHarness(api, builder | { adapter, primary })`; the builder receives harness tools incl. `delegateTo(targetIds)`. The model is behind **`AgLlmAdapter.executeTurn(request) → { stream: AsyncIterable<AgAiEvent>, complete: Promise<AgLlmResponse> }`**, where `request = { input, instructions, tools, toolChoice: 'auto' | 'none' | 'required' | {name}, responseFormat: text | json-schema, model }`. It is provider-neutral.

**Decision: Plan A (Claude for Studio's built-in agents too) is feasible.** An `anthropic-adapter.ts` maps `AgLlmRequest` → a server proxy (`/api/ai`) → the Claude Messages API, and Claude's stream → `AgAiEvent`s. Note: `toolChoice: 'required'` / `{name}` must become `auto` + an instruction on `claude-opus-5-5` (forced tool use is a 400 there); `claude-sonnet-5` accepts forced tool choice. Built in Step 18 with the custom Vigil Ops agent.

**Step 13 scope actually shipped:** the queue is an AG Grid (Community) grid and the Proposal Card is a React component next to it; AG Studio renders an analytics panel over the `exceptions` source. Moving the queue + Proposal Card _into_ Studio as custom widgets with a frozen `initial-report.ts` is Step 17.
