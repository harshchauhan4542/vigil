# 2026-11-02 — Step 19: Hardening and end-to-end tests

**Result:** ✅ Done (Replay world currently synthetic; swap in real sandbox recordings after the first Live run)
**Branch:** `step-19-hardening`

## What was done

- **Zero-key Replay world.** `pnpm demo:build` (`apps/workflows/src/demo/build-demo.ts`) runs every flow against Vigil's fake PayPal and a scripted Claude, records all calls with the replay transport (`fixtures/recordings/`, 59 files) and writes `fixtures/demo/seed.json` + `manifest.json` (`synthetic: true`). In Replay the web app uses an **isolated in-memory database** (never the Live one), loads the seed, runs the first sweep, and runs on the **frozen demo clock** from the manifest. The banner says the data is synthetic.
- Replay key rules: Transaction Search time-window params are ignored; a `PayPal-Mock-Response` call is a separate recording from the real call. The fake PayPal honours the mock header like the sandbox.
- **Replay world test** (`apps/workflows/test/replay-world.test.ts`): fresh database, no network handlers; all 7 exceptions detected, 6 proposals, injection refund rejected, capture / mocked failure / T3 typed amount / tracking / renewal retry / journal entry, settle, audit chain OK.
- **Playwright e2e** (`apps/web/e2e/demo.spec.ts`, production build, Replay, Chromium): queue → proposal → approve → executed; injection blocked; simulated failure → FAILED_FINAL; T3 typed amount; audit chain badge. Screenshots → `docs/screenshots/`. New CI job **e2e**.
- `pnpm demo`: fresh clone → `pnpm i` → `pnpm demo` → http://localhost:3000/control-room, no keys, no Docker (secrets generated per run).
- Security pass: fixture secret scan test (keys, tokens, Basic/Bearer, card numbers, unscrubbed secret fields); webhook cert host check, approval-token replay/forgery, rate limits (429), AI budget (429) and auto-fallback were already covered (Steps 11–14).
- Countdowns in the UI follow the server clock (frozen in Replay).
- `docs/postman/vigil.postman_collection.json` (P3).

## Checks

| Check                                                            | Result                               |
| ---------------------------------------------------------------- | ------------------------------------ |
| lint / typecheck / test / build                                  | ✅                                   |
| e2e (Playwright, Replay, zero keys)                              | ✅ 5/5 locally; CI job added         |
| Fresh clone → `pnpm i` → `pnpm demo` works with no keys / Docker | ✅ (same path as the e2e web server) |

## Decisions

- Synthetic fixtures are labelled as such in the manifest, the banner and the README; they're replaced by real sandbox recordings after a Live run (`RECORD=true`).
- Rebuilding the fixtures changes file contents (new row ids in recorded bodies), so CI checks compatibility with the replay-world test instead of a byte diff.
