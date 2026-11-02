# Vigil: current status

_Keep this file short. Claude updates it at the end of every session._

**Last updated:** 2026-10-30
**Current step:** Step 0, Monorepo and tooling (not started)
**State:** Planning complete. Repo initialised locally with LICENSE, README, CLAUDE.md, plan and worklogs.
**Next action:** Start Step 0 when the user says "start step 0".

## Blockers

- None.

## Open to-dos for the user

| To-do                                                                  | Needed by                         | Done |
| ---------------------------------------------------------------------- | --------------------------------- | ---- |
| Push repo to GitHub: `gh repo create vigil --public --source . --push` | Before Step 14 (sooner is better) | ☐    |
| PayPal sandbox app: Client ID + Secret into `.env`                     | Step 3 (Nov 1)                    | ☐    |
| Sandbox US Business + US Personal accounts, logins into `.env`         | Step 5 (Nov 2)                    | ☐    |
| Request AG Studio 45-day trial (**on Nov 2, not earlier**)             | Step 7 (Nov 2)                    | ☐    |
| Anthropic API key into `.env`, with a monthly spend limit              | Step 9 (Nov 3)                    | ☐    |
| Render account, claim $50 credits, create API key                      | Step 14 (Nov 4)                   | ☐    |
| Record rough video; submit on Devpost                                  | Step 15 (Nov 5)                   | ☐    |

## Step progress

| Step | Name                                     | Status |
| ---- | ---------------------------------------- | ------ |
| 0    | Monorepo and tooling                     | ☐      |
| 1    | Config and core domain                   | ☐      |
| 2    | Database layer and audit log             | ☐      |
| 3    | PayPal client foundation                 | ☐      |
| 4    | PayPal reads, actions, mock responses    | ☐      |
| 5    | Sandbox seeder                           | ☐      |
| 6    | Detectors E3, E4                         | ☐      |
| 7    | Policy engine and approval tokens        | ☐      |
| 8    | Record and replay layer                  | ☐      |
| 9    | Claude agent                             | ☐      |
| 10   | Task runner and workflow tasks           | ☐      |
| 11   | Webhooks and settlement                  | ☐      |
| 12   | Web app API routes                       | ☐      |
| 13   | AG Studio control room                   | ☐      |
| 14   | Deploy to Render                         | ☐      |
| 15   | Early submission pack (Nov 5)            | ☐      |
| 16   | Detectors and playbooks E1 + E2          | ☐      |
| 17   | Remaining widgets, audit and judge pages | ☐      |
| 18   | Custom Studio agent with delegation      | ☐      |
| 19   | Hardening and end-to-end tests           | ☐      |
| 20   | Final video and submission (Nov 11)      | ☐      |

Legend: ☐ not started · 🟡 in progress · ✅ done · ❌ blocked

## History (one line per session, newest last)

| Date       | Step     | Result                                                          | Log                                              |
| ---------- | -------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 2026-10-30 | Planning | ✅ Research, idea, architecture, blueprint, implementation plan | [2026-10-30-planning.md](2026-10-30-planning.md) |
