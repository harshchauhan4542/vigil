# 2026-11-02 — Step 13: AG Studio control room

**Session goal:** the screen judges see first.
**Result:** 🟡 Built and server-rendered; browser check and Studio custom widgets pending
**Branch / commit:** `step-13-control-room`

## What was done

- `/control-room` (server page → client `ControlRoom`): top bar, persistent Live/Replay banner + switch, **Exception Queue** (AG Grid 36.2 Community, `themeQuartz`: type with E-code, target, money at risk, deadline countdown, status, latest proposal, tier; sorted by money × urgency), **Proposal Card** (action + params, policy checklist ✓/✗ per rule with detail, agent rationale + confidence, evidence id chips, settlement trail with `PayPal-Request-Id` / `debug_id`, Approve / Reject, typed amount for T3), **Analytics** panel with `<AgStudioProvider><AgStudio data={{ sources }}/>` (client-only, watermark without licence).
- Live updates: `EventSource('/api/events')` → refetch on every audit event; the card re-reads its proposal.
- `globals.css`: Vigil theme v1 (own palette, light/dark, no PayPal marks).
- 🧪 Spike S3 in `docs/spikes.md`: Plan A feasible (`AgLlmAdapter` is provider-neutral); adapter built in Step 18.

## Checks

| Check                                                                                               | Result                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| lint / typecheck / test / build                                                                     | ✅                                                     |
| Production server renders `/control-room` (queue, card, Studio panel, Replay banner); `/` redirects | ✅                                                     |
| In a browser: queue shows seeded exceptions → card → Approve → row updates live to SETTLED          | ⏳ needs seeded data (keys) and a browser check by you |

## Decisions and deviations from the plan

- Queue and Proposal Card are AG Grid + React components beside Studio, not Studio custom widgets yet (Studio widget forms/data mappings need browser iteration). Moving them into Studio with a frozen `initial-report.ts` is folded into Step 17.
- Plain CSS instead of Tailwind 4 for the first theme (less tooling; same result).

## Left over / next

- Browser walkthrough once data exists. Next: Step 14, Deploy to Render.

## Needs from the user

- `AG_STUDIO` licence key in `.env` when the trial arrives.
