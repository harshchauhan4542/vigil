# Vigil: current status

_Keep this file short. Claude updates it at the end of every session._

**Last updated:** 2026-11-02
**Current step:** Steps 0–5 built (one stacked PR per step, CI green). Steps 3–5 wait only on the live sandbox checks.
**State:** All code and tests for Steps 0–5 done. Live checks not run yet: no `.env` with sandbox keys.
**Next action:** User merges PRs #1–#6 in order and adds sandbox keys to `.env`. Then run `pnpm paypal:smoke`, `pnpm seed` (twice), `pnpm seed:check`, record spike S2 in `docs/spikes.md`, and mark 3–5 ✅. Then Step 6.

## Blockers

- Live sandbox checks for Steps 3–5 need `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` in `vigil/.env` (user to add; never paste keys in chat).

## Open to-dos for the user

| To-do                                                                                                | Needed by       | Done |
| ---------------------------------------------------------------------------------------------------- | --------------- | ---- |
| ~~Push repo to GitHub~~ Done: private `harshchauhan4542/vigil`; **make it public before submitting** | Step 15 (Nov 5) | 🟡   |
| PayPal sandbox app: Client ID + Secret into `.env`                                                   | Step 3 (Nov 1)  | ☐    |
| Sandbox US Business + US Personal accounts, logins into `.env`                                       | Step 5 (Nov 2)  | ☐    |
| Request AG Studio 45-day trial (**today, Nov 2**)                                                    | Step 7 (Nov 2)  | ☐    |
| Anthropic API key into `.env`, with a monthly spend limit                                            | Step 9 (Nov 3)  | ☐    |
| Render account, claim $50 credits, create API key                                                    | Step 14 (Nov 4) | ☐    |
| Record rough video; submit on Devpost                                                                | Step 15 (Nov 5) | ☐    |

## Step progress

| Step | Name                                     | Status                              |
| ---- | ---------------------------------------- | ----------------------------------- |
| 0    | Monorepo and tooling                     | ✅                                  |
| 1    | Config and core domain                   | ✅                                  |
| 2    | Database layer and audit log             | ✅                                  |
| 3    | PayPal client foundation                 | 🟡 live smoke pending keys          |
| 4    | PayPal reads, actions, mock responses    | 🟡 live smoke pending keys          |
| 5    | Sandbox seeder                           | 🟡 live run pending keys + accounts |
| 6    | Detectors E3, E4                         | ☐                                   |
| 7    | Policy engine and approval tokens        | ☐                                   |
| 8    | Record and replay layer                  | ☐                                   |
| 9    | Claude agent                             | ☐                                   |
| 10   | Task runner and workflow tasks           | ☐                                   |
| 11   | Webhooks and settlement                  | ☐                                   |
| 12   | Web app API routes                       | ☐                                   |
| 13   | AG Studio control room                   | ☐                                   |
| 14   | Deploy to Render                         | ☐                                   |
| 15   | Early submission pack (Nov 5)            | ☐                                   |
| 16   | Detectors and playbooks E1 + E2          | ☐                                   |
| 17   | Remaining widgets, audit and judge pages | ☐                                   |
| 18   | Custom Studio agent with delegation      | ☐                                   |
| 19   | Hardening and end-to-end tests           | ☐                                   |
| 20   | Final video and submission (Nov 11)      | ☐                                   |

Legend: ☐ not started · 🟡 in progress · ✅ done · ❌ blocked

## History (one line per session, newest last)

| Date       | Step     | Result                                                                                                | Log                                                                        |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2026-10-30 | Planning | ✅ Research, idea, architecture, blueprint, implementation plan                                       | [2026-10-30-planning.md](2026-10-30-planning.md)                           |
| 2026-11-02 | 0        | ✅ Monorepo, tooling, boundary lint rules, private GitHub repo, CI                                    | [2026-11-02-step-00-monorepo.md](2026-11-02-step-00-monorepo.md)           |
| 2026-11-02 | 1        | ✅ Config loaders, money, enums, state machines, schemas, params hash                                 | [2026-11-02-step-01-config-core.md](2026-11-02-step-01-config-core.md)     |
| 2026-11-02 | 2        | ✅ Drizzle schema, PGlite/pg, append-only hash-chained audit, repos                                   | [2026-11-02-step-02-db.md](2026-11-02-step-02-db.md)                       |
| 2026-11-02 | 3        | 🟡 Token cache, http, errors, idempotency, SDK spike; live smoke pending                              | [2026-11-02-step-03-paypal-client.md](2026-11-02-step-03-paypal-client.md) |
| 2026-11-02 | 4        | 🟡 Reads, actions, sandbox setup, mock allowlist; live smoke pending                                  | [2026-11-02-step-04-paypal-calls.md](2026-11-02-step-04-paypal-calls.md)   |
| 2026-11-02 | 5        | 🟡 Idempotent seeder + seed:check, tested on a fake PayPal; live run pending                          | [2026-11-02-step-05-seeder.md](2026-11-02-step-05-seeder.md)               |
| 2026-11-02 | 6        | ✅ E3 + E4 detectors, scoring, detect_exceptions sync                                                 | [2026-11-02-step-06-detectors.md](2026-11-02-step-06-detectors.md)         |
| 2026-11-02 | 7        | ✅ Policy R1–R10, approval tokens, typed T3 confirmation                                              | [2026-11-02-step-07-policy.md](2026-11-02-step-07-policy.md)               |
| 2026-11-02 | 8        | ✅ Record/replay fetch transport, scrubbing, file + DB stores                                         | [2026-11-02-step-08-replay.md](2026-11-02-step-08-replay.md)               |
| 2026-11-02 | 9        | 🟡 Claude tool loop, read/propose tools, toolkit quarantine, replayable; live fixtures pending key    | [2026-11-02-step-09-agent.md](2026-11-02-step-09-agent.md)                 |
| 2026-11-02 | 10       | 🟡 Task runner, gate, execute/triage/detect/settle tasks; exactly-once proven in tests; live pending  | [2026-11-02-step-10-tasks.md](2026-11-02-step-10-tasks.md)                 |
| 2026-11-02 | 11       | 🟡 Webhook verify (postback + self + simulator rule), receiver, process_webhook; real webhook pending | [2026-11-02-step-11-webhooks.md](2026-11-02-step-11-webhooks.md)           |
| 2026-11-02 | 12       | ✅ Next.js API routes, gate behind approve, SSE, sessions, rate limits                                | [2026-11-02-step-12-web-api.md](2026-11-02-step-12-web-api.md)             |
