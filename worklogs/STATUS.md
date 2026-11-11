# Vigil: current status

_Keep this file short. Claude updates it at the end of every session._

**Last updated:** 2026-11-02
**Current step:** All 21 steps (0–20) are coded; stacked PRs #1–#21 with CI (incl. Playwright e2e from Step 19).
**State:** Everything that can be built and tested without your accounts is done and green, including a zero-key Replay demo (`pnpm demo`, currently synthetic data). Live checks, the deploy, real recordings, the video and the Devpost submission are waiting on you.
**Next action:** You: merge PRs in order, add keys, follow docs/deploy.md and docs/final-checklist.md. Me (when asked): run the live checks (Steps 3–5, 9–11, 16, 18), record real fixtures, fix anything the sandbox surfaces.

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
| 2026-11-02 | 13       | 🟡 Control room: AG Grid queue, Proposal Card, SSE, Studio analytics; spike S3 = Plan A               | [2026-11-02-step-13-control-room.md](2026-11-02-step-13-control-room.md)   |
| 2026-11-02 | 14       | 🟡 render.yaml, bundled worker/cron, auto-fallback to Replay, deploy guide; deploy pending account    | [2026-11-02-step-14-render.md](2026-11-02-step-14-render.md)               |
| 2026-11-02 | 15       | 🟡 README + Tools Statement, negative-testing, architecture, Devpost draft                            | [2026-11-02-step-15-submission.md](2026-11-02-step-15-submission.md)       |
| 2026-11-02 | 16       | 🟡 E1 + E2 detectors, sync, agent tools, e2e tests                                                    | [2026-11-02-step-16-e1-e2.md](2026-11-02-step-16-e1-e2.md)                 |
| 2026-11-02 | 17       | 🟡 W1, W2, W4, /audit, /judge, simulate-failure toggle                                                | [2026-11-02-step-17-widgets.md](2026-11-02-step-17-widgets.md)             |
| 2026-11-02 | 18       | 🟡 Claude adapter for Studio agents, Vigil Ops agent, delegation harness                              | [2026-11-02-step-18-studio-agent.md](2026-11-02-step-18-studio-agent.md)   |
| 2026-11-02 | 19       | ✅ Zero-key Replay world, Playwright e2e in CI, pnpm demo, security scan, Postman                     | [2026-11-02-step-19-hardening.md](2026-11-02-step-19-hardening.md)         |
| 2026-11-02 | 20       | 🟡 Final README, Devpost draft, final + keep-alive checklist                                          | [2026-11-02-step-20-final.md](2026-11-02-step-20-final.md)                 |
