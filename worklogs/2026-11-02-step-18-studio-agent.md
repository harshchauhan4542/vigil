# 2026-11-02 — Step 18: Custom Studio agent with delegation

**Result:** 🟡 Built against the real AG Studio 3.0 types and unit/route-tested; needs a browser run with a Claude key (and the licence)
**Branch:** `step-18-studio-agent`

## What was done

- **Plan A (spike S3):** Studio's built-in agents (`lead`, `data`, `page`, `planning`, `widget`) run on Claude. `app/control-room/studio/anthropic-adapter.ts` implements `AgLlmAdapter.executeTurn` by POSTing the `AgLlmRequest` to **`/api/ai`**, which translates it (`lib/studio-ai.ts`) to the Messages API (`claude-sonnet-5`, adaptive thinking, low effort; `required` → `{type:'any'}`, JSON formats → structured output) and returns an `AgLlmResponse`. Rate-limited and inside the daily AI budget.
- **Vigil Ops agent** (`vigil-ops-agent.ts`): a `clientToolRunner` that streams `/api/agent/stream` (the Claude loop with read + DRAFT-only propose tools) and translates it into AG-UI events (RUN_STARTED, TEXT_MESSAGE__, TOOL_CALL__, RUN_FINISHED / RUN_ERROR), appending each new proposal's policy verdict.
- **Harness** (`harness.ts`): `createAiHarness(api, ({ tools, builtIn }) => …)`; the built-in `lead` agent is primary and gets `tools.delegateTo(['vigil-ops'])` plus an instruction to route money questions there; charts and widgets stay with Studio's dashboard agents. Prompt starters for both. Wired into `<AgStudio ai={vigilHarness}>`.

## Checks

| Check                                                                       | Result                                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| lint / typecheck / test / build                                             | ✅ (web 19: translation both ways, tool-choice mapping, AG-UI event mapping, `/api/ai` through the fake Claude) |
| In the browser: one chat message produces a proposal and a new chart widget | ⏳ needs a Claude key and a browser                                                                             |

## Decisions and deviations from the plan

- The plan had Vigil Ops as primary delegating to the dashboard agent. Studio's custom runners can't easily call `delegateTo` themselves, so the built-in `lead` agent is primary and delegates to Vigil Ops; delegation still happens through Studio's harness in one chat.
- Studio's AI requests reach Claude only through `/api/ai` (no browser-side keys); those agents can change the dashboard but cannot reach money.
