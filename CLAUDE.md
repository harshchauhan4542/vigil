# Vigil: project instructions for Claude

**What:** an AI money-ops control room for PayPal merchants, built for the PayPal AI Hackathon 2026 (paypalaihackathon.devpost.com). It detects money exceptions in a PayPal account and shows them in one AG Studio queue. A Claude agent _proposes_ fixes; a deterministic policy engine plus a human approval decide; Render Workflows execute against the PayPal **sandbox** with `PayPal-Request-Id`; verified webhooks settle.

**Deadline:** Nov 12, 2026, 12:00 PM PT (1:30 AM IST Nov 13). Early submission target Nov 5. Final target Nov 11. The user is in India (IST).

## Start of every session (do this, in order, and nothing more)

1. Read `worklogs/STATUS.md`: current step, next action, blockers, open user to-dos.
2. Read the newest file in `worklogs/` (latest session log) only if STATUS.md says a step is mid-way.
3. Read **only the section** of `docs/IMPLEMENTATION_PLAN.md` for the current step.
4. Open the big reference docs **only when the current step needs a specific detail**, and read only the relevant section (use Grep on headings first):
   - `../HACKATHON_ARCHITECTURE_PLAN.md`: architecture, DB schema, state machines, PayPal endpoints and payloads, policy rules R1–R10, webhook verification, negative testing, video script
   - `../BUILD_BLUEPRINT.md`: tech stack with versions, monorepo layout, trust-boundary import rules, env vars
   - `../research_notes/PayPal AI hackathon plan/*.md`: raw research (rarely needed)
   - `../VIGIL_FOR_MERCHANTS.md`: plain-language product pitch

Do not re-research or re-plan decided things. If something in the docs is wrong, fix the doc and note it in the worklog.

## Stack (decided)

Node 22 · TypeScript strict ESM · pnpm workspaces + Turborepo · Next.js 16 + React 19 + AG Studio 3.0 + AG Grid 36.2 + Tailwind 4 · Render Workflows (`@renderinc/sdk`) + Render cron, Postgres, Key Value · Drizzle ORM (PGlite locally, `pg` on Render) · ioredis (memory cache locally) · Zod 4 · `@paypal/paypal-server-sdk` 2.5.0 + raw fetch for other PayPal APIs · `@paypal/agent-toolkit` read tools (quarantined in `packages/agent/src/toolkit-adapter.ts`) · `@anthropic-ai/sdk` (`claude-sonnet-5` interactive, `claude-opus-5-5` batch) · Vitest + MSW + Playwright · pino. **No Docker.**

## Layout

`apps/web` (UI + API routes + approval gate) · `apps/workflows` (Render tasks + cron) · `packages/{core,config,db,paypal,policy,detectors,agent,replay,tasks}` · `tooling/` · `scripts/` · `fixtures/` · `docs/` · `worklogs/`

## Hard rules

- **Trust boundary:** only `packages/paypal/src/actions.ts` moves money, and only `apps/workflows` may import it. `policy` and `detectors` are pure and never import the LLM SDK. `agent` can only insert DRAFT proposals. Never weaken the ESLint boundary rules.
- Money is integer cents, never floats.
- Every mutating PayPal call uses a persisted `PayPal-Request-Id` written **before** the call. Never blind-retry past the retention window.
- `PayPal-Mock-Response` applies only to Orders v2 and Payments v2. Don't claim mocks elsewhere.
- **Secrets:** never ask the user to paste keys into chat; they edit `.env` themselves. Never commit `.env` or put secrets in fixtures or logs.
- Don't overclaim in UI or docs (for example, Vigil does not compute Seller Protection eligibility).

## Working rules

- **One step per session** unless the user says otherwise. Work on branch `step-NN-short-name`.
- A step is done only when `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass, plus the step's "Done when" checks. Report failures honestly with output.
- Commit at the end of a step (message ends with the Co-Authored-By line). Push or open a PR only if the user asks.
- Stop after the step and wait for the user's review. Don't start the next step on your own.
- Keep replies short. Don't paste large file contents back into chat.

## End of every session (mandatory)

1. Write or append the session log `worklogs/YYYY-MM-DD-step-NN-<short-name>.md` using `worklogs/_TEMPLATE.md`.
2. Update `worklogs/STATUS.md`: current step and state, next action, blockers, user to-dos, and add one line to its history table.
3. Commit the worklog changes with the step's code.
