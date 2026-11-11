# 2026-11-11 — Free LLM provider (Groq, gpt-oss-120b) + local .env fix

**Session goal:** run Live without paying for an Anthropic key; merge all stacked PRs.
**Result:** ✅ Done
**Branch / commit:** `llm-provider`

## What was done

- Merged all stacked PRs #10–#22 into `main` (top-down, CI green on the final merge).
- PayPal sandbox live smoke ✅ (`pnpm paypal:smoke`: token + order create/read). Steps 3–4 live check done.
- `packages/agent/src/openai-compat.ts`: OpenAI-compatible provider behind the Anthropic client surface (`messages.stream` / `messages.create`). Translates tools, tool calls/results, system, json format; drops Claude-only knobs; retries 429/5xx (retry-after) and Groq `tool_use_failed`; goes through the record/replay transport.
- `createLlmClient` / `llmConfigured` in `packages/agent/src/client.ts`; used by `apps/web/lib/server.ts` and `apps/workflows/src/bootstrap.ts`. Replay always uses the Claude-format client (the shipped synthetic world).
- Config: `LLM_PROVIDER` (anthropic|openai, default anthropic), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MAX_OUTPUT_TOKENS`; Live requires the chosen provider's key and rejects `claude-*` model names with provider openai.
- `apps/web` `dev`/`start` now load `vigil/.env` (`node --env-file-if-exists=../../.env`). Before this, `pnpm dev` never saw the root `.env` and Live silently fell back to Replay.
- README Tools Statement, Devpost draft, `.env.example`, REQUIREMENTS updated (no Claude claims for Live).

## Checks

| Check                           | Result                                      |
| ------------------------------- | ------------------------------------------- |
| lint / typecheck / test / build | ✅ (`pnpm check`, format:check)             |
| e2e (Replay)                    | ✅ 5/5 on the new build                     |
| New tests                       | ✅ 10 adapter tests + 2 config tests        |
| Real Groq call                  | ✅ gpt-oss-120b returned a correct tool_use |

## Decisions and deviations from the plan

- User chose not to pay for Anthropic. Default Live model: `openai/gpt-oss-120b` on Groq's free tier. Claude stays supported (`LLM_PROVIDER=anthropic`). (Docs updated: yes.)
- Adapter is non-streaming (whole text in one event): simpler, replay-friendly.
- Replay with Groq recordings is not wired (Replay uses the Claude-format synthetic world).

## Problems and how they were solved

- `.env` was in the parent folder, then had `hhtps://` in `LLM_BASE_URL` → moved by user; typo fixed.
- A leftover `next start` held port 3000, so the first e2e run hit the old build → killed it and reran.
