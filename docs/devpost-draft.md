# Devpost draft (copy-paste)

Only you can submit on Devpost. This file is the text to paste into each field of the form.
The video plan is in `docs/final-checklist.md`.

## Tagline

AI that finds the money, and code that guards it: a gated money-ops control room for PayPal merchants.

## Description

**Vigil** watches a merchant's PayPal account for money exceptions (authorization holds about to lose their 3-day honor period, failed subscription renewals, captured orders with no tracking, PayPal transactions that don't match the books) and puts them in one prioritized queue. An AI agent (open-source **gpt-oss-120b** on Groq, or Claude) investigates each one with read-only tools and _proposes_ a fix with cited evidence.

Nothing the AI says moves money. A deterministic gate re-reads the target from **PayPal**, checks ten rules (allowlist, schema, fresh state, bounds, caps, uniqueness, grounding, dispute guard, kill switch, tiering), and a human approves. Approval mints a single-use token bound to the exact parameters. A **Render Workflow** executes with a `PayPal-Request-Id` written to the database before the call, retries only with the same id, and a verified PayPal webhook settles it. Every step lands in a hash-chained, append-only audit log.

**What the merchant sees:**

- money at risk and a 72-hour deadline timeline;
- five ready-made charts: problems found vs. fixed, money at risk over time, money coming due, money at risk by problem, and problems by status;
- a plain-language problems table, where every fix shows its reasons and safety checks next to **Approve** / **Say no**;
- a step-by-step "What happened" trail;
- an AG Studio canvas for their own charts, with an AI assistant that answers questions;
- a tamper-evident history.

What we tested end to end: double approval → one PayPal effect; forced 503 and lost responses → one effect; retries exhausted → a GET decides; a seeded customer note telling the AI to "refund $900" → the refund proposal is rejected by policy. Judges can run it **Live** against the PayPal sandbox or in zero-key **Replay** (`pnpm demo` works from a fresh clone, no keys, no Docker). AG Studio's built-in assistant runs on the same model and delegates money questions to our Vigil Ops agent.

**PayPal APIs used:** Orders v2, Payments v2 (authorizations, captures, refunds), Subscriptions v1, Catalog Products v1, Transaction Search v1, Shipment Tracking v1, Invoicing v2, Disputes v1, Webhooks v1 (signature verification), plus `@paypal/paypal-server-sdk` (and a quarantined, read-only `@paypal/agent-toolkit` adapter, not enabled in the hosted agent).

**AI used:** OpenAI's open-weight `gpt-oss-120b`, served free by Groq through its OpenAI-compatible API (interactive agent and batch triage). Claude (`claude-sonnet-5` / `claude-opus-5-5`) is supported as an alternative provider. The code was written with Claude Code. See the Tools Statement in the README.

**Not a fork:** fresh MIT repository; the PayPal × AG Grid boilerplate was a reference only.

## Built With

`paypal` · `paypal-orders-v2` · `paypal-payments-v2` · `paypal-webhooks` · `paypal-transaction-search` · `paypal-server-sdk` · `paypal-agent-toolkit` · `groq` · `gpt-oss` · `claude` · `ag-grid` · `ag-charts` · `ag-studio` · `render` · `render-workflows` · `postgresql` · `next.js` · `typescript` · `drizzle` · `vitest`

## Links

- Repository (public, MIT): https://github.com/harshchauhan4542/vigil
- Run it (functional demo): `git clone https://github.com/harshchauhan4542/vigil.git && cd vigil && pnpm install && pnpm demo`, then open http://localhost:3000/control-room (no keys, no Docker; steps in the README)
- Hosted demo: https://vigil-web-vxpb.onrender.com/control-room
- Video: _YouTube, public, under 3:00, no unlicensed music_

## Submission checklist (Devpost requirements)

| Requirement                                                  | Where it is satisfied                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Project built with the required tools                        | PayPal sandbox APIs + `@paypal/paypal-server-sdk`, AG Grid / AG Charts / AG Studio, Render (README "Tools Statement") |
| Text description                                             | "Description" above                                                                                                   |
| Functional demo                                              | Run instructions in the README (`pnpm install && pnpm demo`, verified from a fresh clone); hosted URL optional        |
| Tools (models / AI services) and how they were used          | README "Tools Statement"; "AI used" above                                                                             |
| Public repo with all source, assets and instructions         | https://github.com/harshchauhan4542/vigil (public)                                                                    |
| Open-source licence visible in the repo's About section      | MIT (`LICENSE`), detected by GitHub                                                                                   |
| Demo video (< 3 min, public on YouTube, no unlicensed music) | **To do by the owner**: script in `docs/final-checklist.md`                                                           |
