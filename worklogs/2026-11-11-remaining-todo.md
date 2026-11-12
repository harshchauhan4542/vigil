# 2026-11-11: What's left to do (Step 4 onwards)

**Deadline:** Nov 12 2026, 12:00 PM PT (**1:30 AM IST on Nov 13**). Judging runs until Dec 15, 08:00 PT, so the hosted app must stay up until then.
**State today:** all code is merged into `main` and CI is green. The app runs locally in Demo and Live. It uses the free Groq model `openai/gpt-oss-120b`, so no Anthropic key is needed. The repo is public.

Do these in order. Tick each box as you finish it.

---

## Step 4: fill the PayPal sandbox with test orders (~15 min)

Stop `pnpm dev` first. Only one program can open the local database at a time.

- [x] In the VS Code terminal, inside the `vigil` folder, run `pnpm seed`.
- [x] If it prints **approval links**, open each one and log in as the **test buyer** (`PAYPAL_SANDBOX_PERSONAL_EMAIL` and its password in `.env`). Click **Agree & Pay**, **Continue** or **Subscribe**.
- [x] Run `pnpm seed` again. Running it twice is safe and creates no duplicates.
- [x] Run `pnpm seed:check` and keep the last ~15 lines of its output.
- [x] Note the result in `docs/spikes.md` (spike S2: did the buyer links need approving?).

**Done when:** `seed:check` reports the expected orders, holds and subscriptions with no errors.

**Result (2026-11-12): ✅ done.**

- **First try failed.** The default sandbox Business account was **India (IN)**, and PayPal declined every order ("To comply with international regulations…").
- **Fix:**
  - created a **US Business** sandbox account plus a new app, **Vigil US**, linked to it;
  - switched to a **US Personal** buyer;
  - updated `.env`;
  - moved the old local data aside to `.data/pglite-backup-india-shop`;
  - re-seeded.
- **Card payments:** the sandbox shop has no card processing (`PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`), so every order used a buyer-approval link (spike S2, Plan B).
- **Final `seed:check`:**
  - 4 holds CREATED;
  - 4 sales COMPLETED (`cap:1` and `cap:2` tracked);
  - 3 subscriptions ACTIVE;
  - 9 ledger rows, 1 customer note, nothing pending.
- **Tip:** if the PayPal developer dashboard's buttons spin forever, do a hard refresh (Ctrl + Shift + R). One of PayPal's script files was failing to load.

**Timing check.** I ran the real detectors on the real mirrored sandbox data at simulated future times, read-only:

- +0 to 23 h: no problems;
- +25 h: the 2 untracked sales (E2, 24 h grace);
- +61 h: all 4 holds (E3, 12 h before the 3-day honor end);
- +73 h: the holds move to the 29-day validity deadline, and the untracked sales become overdue.

So in Live, the real problems appear about 1 to 2.5 days after seeding. Demo mode shows every case immediately.

**Transaction search.** I ticked "Transaction search" on the Vigil US app. PayPal still returned 403 right after, because new permissions can take time. Until it starts working, E4 (the books check) is skipped, which is by design.

## Step 5: first real (Live) run on your computer (~10 min)

- [ ] Run `pnpm dev`, then open http://localhost:3000.
- [ ] Switch the top bar to **Live**.
- [ ] Go to **Help** and press **Check PayPal now**.
- [ ] Open **Problems**, pick one, read the suggested fix and press **Approve**.
- [ ] Watch "What happened" until it says **Done**.
- [ ] Optional: take new screenshots with real data for `docs/screenshots/`.

**Done when:** at least one real sandbox problem goes from "Needs your OK" to "Done".

## Step 6: put the app online on Render (~45 min)

Follow `docs/deploy.md` (sections 0–5). Type secrets only into the Render dashboard, never into git or chat.

- [ ] Create a Render account and claim the hackathon credits.
- [ ] **New → Blueprint** → repo `vigil`, branch `main`. Render reads `render.yaml`.
- [ ] Fill in the secret values: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` and `AG_STUDIO` (optional). Leave `ANTHROPIC_API_KEY` empty.
- [ ] **Groq instead of Claude.** `render.yaml` still sets the Claude model names. In the `vigil-shared` group, set or override these:
  - `LLM_PROVIDER` = `openai`
  - `LLM_BASE_URL` = `https://api.groq.com/openai/v1`
  - `LLM_API_KEY` = your Groq key
  - `VIGIL_MODEL_INTERACTIVE` = `openai/gpt-oss-120b`
  - `VIGIL_MODEL_BATCH` = `openai/gpt-oss-120b`
- [ ] Create the **Workflow** service by hand, named exactly `vigil-workflows`. Use the build and start commands in `docs/deploy.md` §2, link the `vigil-shared` group, and add `DATABASE_URL` and `REDIS_URL`.
- [ ] Create a Render **API key** and save it in `vigil-shared` as `RENDER_API_KEY`.
- [ ] In the PayPal developer site, add a **webhook** pointing at `https://<your-web>.onrender.com/api/webhooks/paypal`, using the event list in `docs/deploy.md` §4. Save its ID as `PAYPAL_WEBHOOK_ID`.
- [ ] Open `https://<your-web>.onrender.com/api/health`. It should show `"mode":"live"` and no `fallback`.
- [ ] Seed on Render: in the `vigil-workflows` **Shell**, run `pnpm seed` twice, then `pnpm seed:check`.
- [ ] Click through the hosted app in a private browser window, in both Live and Demo.

**Done when:** the hosted link works for a stranger, in both Live and Demo.

## Step 7: record the demo video (~45 min)

- [ ] Use the ~2:50 script in `docs/final-checklist.md` ("Final video").
- [ ] Record on the hosted app in Live mode. Show:
  - a problem being approved and reaching Done;
  - the "refund $900" note being **Blocked by safety rules**;
  - the $612 fix needing the typed amount;
  - a simulated PayPal failure;
  - the History page with the hash chain verified.
- [ ] Keep it under **3:00** with no copyrighted music.
- [ ] Upload to YouTube as **Public** (or Unlisted only if the rules allow it).

## Step 8: submit on Devpost (~20 min)

- [ ] Check the GitHub repo is still **public** and that the licence shows in the About sidebar.
- [ ] Optional: under GitHub Settings → Branches, require the "lint · typecheck · test · build" and "e2e" checks on `main`.
- [ ] Copy the text from `docs/devpost-draft.md` into the Devpost form.
- [ ] Add the **hosted Render link**, the **YouTube link** and the Built With tags.
- [ ] Update the "Hosted demo" and "Video" links in `docs/devpost-draft.md` and the README.
- [ ] **Submit** before 1:30 AM IST on Nov 13. Aim for the evening of Nov 12 IST to leave a buffer.

## After submitting: keep it alive until Dec 15

- [ ] Set calendar reminders for **Dec 1** and **Dec 10**. On each date, open the hosted link, check `/api/health` and approve one fix in Live.
- [ ] Check that the Render credits and plan are still active and that the Postgres database hasn't expired.
- [ ] Check that the PayPal sandbox app and webhook are still registered. The nightly reseed job keeps fresh test data coming.
- [ ] Check the Groq free-tier limits. If Groq stops answering, Demo (Replay) mode still works with no key.
- [ ] Optional: the AG Studio trial licence removes the watermark. Without it, the app still works.

---

## Optional clean-ups

- [ ] Delete the old `step-*` branches on GitHub. They still have the old commit messages.
- [ ] Delete the local backup branch `backup/main-before-rewrite` once you're happy.
- [ ] Record real Live replay fixtures (`RECORD=true`, see `docs/deploy.md` §5) if you want Demo mode to replay real sandbox data instead of the built-in test data.
