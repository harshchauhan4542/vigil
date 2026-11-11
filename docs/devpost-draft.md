# Devpost draft (copy-paste)

Only you can submit on Devpost. This file is the text to paste, plus the early-submission video
plan adjusted to what P0 shows today. Scenes that need P1 features are marked; skip them in the
Nov 5 rough cut.

## Tagline

AI that finds the money, and code that guards it: a gated money-ops control room for PayPal merchants.

## Description

**Vigil** watches a merchant's PayPal account for money exceptions (authorization holds about to lose their 3-day honor period, failed subscription renewals, captured orders with no tracking, PayPal transactions that don't match the books) and puts them in one prioritized queue. A **Claude** agent investigates each one with read-only tools and _proposes_ a fix with cited evidence.

Nothing the AI says moves money. A deterministic gate re-reads the target from **PayPal**, checks ten rules (allowlist, schema, fresh state, bounds, caps, uniqueness, grounding, dispute guard, kill switch, tiering), and a human approves. Approval mints a single-use token bound to the exact parameters. A **Render Workflow** executes with a `PayPal-Request-Id` written to the database before the call, retries only with the same id, and a verified PayPal webhook settles it. Every step lands in a hash-chained, append-only audit log.

What we tested end to end: double approval → one PayPal effect; forced 503 and lost responses → one effect; retries exhausted → a GET decides; a seeded customer note telling the AI to "refund $900" → the refund proposal is rejected by policy. Judges can run it **Live** against the PayPal sandbox or in zero-key **Replay** (`pnpm demo` works from a fresh clone, no keys, no Docker). AG Studio's built-in assistant runs on Claude and delegates money questions to our Vigil Ops agent.

**PayPal APIs used:** Orders v2, Payments v2 (authorizations, captures, refunds), Subscriptions v1, Catalog Products v1, Transaction Search v1, Shipment Tracking v1, Invoicing v2, Disputes v1, Webhooks v1 (signature verification), plus `@paypal/paypal-server-sdk` (and a quarantined, read-only `@paypal/agent-toolkit` adapter, not enabled in the hosted agent).

**AI used:** Claude `claude-sonnet-5` (interactive agent) and `claude-opus-5-5` (batch triage) via the Anthropic API. See the Tools Statement in the README.

**Not a fork:** fresh MIT repository; the PayPal × AG Grid boilerplate was a reference only.

## Built With

`paypal` · `paypal-orders-v2` · `paypal-payments-v2` · `paypal-webhooks` · `paypal-transaction-search` · `paypal-server-sdk` · `paypal-agent-toolkit` · `claude` · `anthropic` · `ag-grid` · `ag-studio` · `render` · `render-workflows` · `postgresql` · `next.js` · `typescript` · `drizzle` · `vitest`

## Links

- Repository: https://github.com/harshchauhan4542/vigil (make it **public** before submitting)
- Hosted demo: _add after deploying (docs/deploy.md)_
- Video: _YouTube, public, under 3:00, no unlicensed music_

## Rough video (Nov 5), ~2:30

| Time      | Scene            | On screen                                                                                                                                                                                     |
| --------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Hook             | Queue with seeded exceptions; money at risk column                                                                                                                                            |
| 0:20–0:35 | Problem          | "Agents that can call payment APIs have no brakes"                                                                                                                                            |
| 0:35–1:20 | Live flow        | Select the E3 hold → Proposal Card (capture $48, checklist all ✓, evidence ids, rationale) → Approve → settlement trail shows PayPal-Request-Id and debug_id → webhook settles → row RESOLVED |
| 1:20–1:50 | Safety           | Two tabs approve the same proposal → one execution. The $612 hold asks for the typed amount. The "refund $900" note → POLICY_REJECTED (R4, R7)                                                |
| 1:50–2:15 | Failure handling | In the Proposal Card pick "Simulate PayPal failure → AUTHORIZATION_EXPIRED" and approve: 422 with debug_id on the trail                                                                       |
| 2:15–2:30 | Close            | Audit chain ✓ at `/api/audit`, Replay banner, repo + MIT                                                                                                                                      |

For the final video use the plan in `docs/final-checklist.md` (adds the AG Studio agent, the in-app failure toggle, E1/E2).

Record against Live; keep a Replay take as backup.
