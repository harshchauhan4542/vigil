# Final submission and keep-alive checklist (Nov 11 → Dec 15)

Everything here needs you (accounts, keys, recording, Devpost). Tick as you go.

## Before the final submission (target Nov 11, buffer Nov 12)

- [ ] Keys in `.env`: PayPal sandbox app, Anthropic (with a monthly spend limit), AG Studio licence.
- [ ] `pnpm paypal:smoke`, `pnpm seed` (twice), `pnpm seed:check` — record the spike S2 result in `docs/spikes.md`.
- [ ] Deploy per `docs/deploy.md`; `/api/health` shows `"mode":"live"` with no `fallback`.
- [ ] One full Live run with `RECORD=true`: detect → triage → approve → webhook settles. Then commit the real recordings to `fixtures/recordings/` and set `"synthetic": false` in `fixtures/demo/manifest.json` (or keep the synthetic world as the Replay default and say so).
- [ ] Click the judge guide in a fresh browser (no cookies) in both Live and Replay.
- [ ] Re-take `docs/screenshots/` from Live if you want real data in them (`pnpm e2e` regenerates the Replay ones).
- [ ] Repo **public**; LICENSE shows in the GitHub About sidebar. With a public repo, enable the required CI checks on `main` (Settings → Branches → require "lint · typecheck · test · build" and "e2e").
- [ ] README Tools Statement: add the PayPal AI-Toolkit / APIMatic Claude Code plugins if you used them.
- [ ] Video < 3:00, public on YouTube, no unlicensed music (script below).
- [ ] Devpost: paste `docs/devpost-draft.md`, add the hosted URL, video, Built With tags; submit. APIMatic claim form if eligible.

## Final video (≈ 2:50)

| Time      | Scene                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Money-at-risk tile and the queue: holds expiring, a failed renewal, an untracked shipment, books that don't match                                             |
| 0:20–0:35 | The risk: agents that can call payment APIs have no brakes                                                                                                    |
| 0:35–1:20 | Live: select the E3 hold → Proposal Card (✓ checklist, rationale, evidence) → Approve → trail shows PayPal-Request-Id + debug_id → webhook settles → RESOLVED |
| 1:20–1:45 | AG Studio assistant: "What needs my attention?" (Vigil Ops agent) then "Chart money at risk by exception type" (Studio's dashboard agents add a widget)       |
| 1:45–2:25 | Safety: simulate AUTHORIZATION_EXPIRED (422 + debug_id); two tabs approve once; $612 needs the typed amount; the "refund $900" note → POLICY_REJECTED         |
| 2:25–2:50 | Architecture (three tiers), `/audit` chain ✓, Replay banner, repo + MIT                                                                                       |

## Keep alive until judging ends (Dec 15, 08:00 PT)

- [ ] Calendar reminders Dec 1 and Dec 10: open the hosted URL, check `/api/health`, run one approval in Live.
- [ ] Render credits and plan still active; Postgres not expired (free/basic tiers can expire — check the dashboard).
- [ ] Anthropic spend limit covers ~6 weeks of judge traffic; `AI_DAILY_TOKEN_BUDGET` keeps a bad day bounded, and Replay is the fallback.
- [ ] PayPal sandbox app and webhook still registered; the nightly reseed cron keeps fresh holds near their honor limit.
- [ ] AG Studio trial licence lasts to Dec 15 (45 days from the Nov 2 request); without it Studio shows a watermark but works.
