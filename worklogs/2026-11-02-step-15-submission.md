# 2026-11-02 — Step 15: Early submission pack

**Session goal:** a complete, eligible Devpost submission.
**Result:** 🟡 Repository side done; hosted URL, video and the Devpost submission are yours to do
**Branch / commit:** `step-15-submission`

## What was done

- `README.md`: what it does, the three trust tiers, P0 exceptions, judge guide (Replay first, then Live, with the double-approve / typed-amount / injection demos), local run steps, Live commands, architecture diagram + package map, **Tools Statement**, honest limits, origin (not a fork), license.
- `docs/negative-testing.md`: exactly which operations use `PayPal-Mock-Response` (Orders v2 / Payments v2 allowlist), which use real invalid-state calls, and the synthetic transport faults used only in tests.
- `docs/architecture.md`: tiers, proposal lifecycle diagram, data flow, Live/Replay.
- `docs/devpost-draft.md`: tagline, description, Built With tags, links, and a rough-cut video plan limited to what P0 shows.
- Secret scan of the repo and history: no real secrets; fake test keys renamed so scanners don't flag them; the test-only webhook key pair is documented in `fixtures/webhooks/README.md`.

## Checks

| Check                                                                                                                                        | Result                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| lint / typecheck / test / build                                                                                                              | ✅                                    |
| Submission checklist (repo side): LICENSE, `.env.example` only, README sections, Tools Statement, negative-testing boundary, not-a-fork note | ✅                                    |
| Public repo with LICENSE badge                                                                                                               | ⏳ repo is private (your call)        |
| Hosted URL with Live + Replay                                                                                                                | ⏳ deploy (docs/deploy.md) + fixtures |
| Video < 3:00, public                                                                                                                         | ⏳ you record                         |
| Devpost submitted                                                                                                                            | ⏳ only you can submit                |

## Decisions and deviations from the plan

- The Tools Statement doesn't claim the PayPal AI-Toolkit or APIMatic Claude Code plugins were used, because they weren't in these sessions; there's a note to add them if you use them.

## Left over / next

- Your steps for Nov 5: keys → seed → deploy → record fixtures → make repo public → video → submit.
- Next build step: 16 (E1 + E2).

## Needs from the user

- Everything in "Open to-dos" in STATUS.md.
