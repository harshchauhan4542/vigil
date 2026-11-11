# What you need to provide

Everything Vigil needs from you, in the order you'll need it. Put values in `vigil/.env` yourself
(copy it from `.env.example`). Never paste keys into chat and never commit `.env`.

Without any of this you can already run the zero-key demo: `pnpm install && pnpm demo`
(Replay mode, synthetic data).

---

## 1. Accounts to create

| #   | Account                                     | Where                                                                          | Needed for                            |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| 1   | PayPal Developer account                    | https://developer.paypal.com                                                   | Everything Live                       |
| 2   | PayPal **sandbox app** (REST)               | Developer Dashboard → Apps & Credentials → toggle **Sandbox** → **Create App** | Client ID + Secret                    |
| 3   | Sandbox **Business** account (the merchant) | Dashboard → Sandbox → **Accounts** (usually created for you with the app)      | Owns the app's money                  |
| 4   | Sandbox **Personal** account (the buyer)    | Dashboard → Sandbox → Accounts → **Create account** → Personal, US             | Approving seeded orders/subscriptions |
| 5   | Anthropic Console account                   | https://console.anthropic.com                                                  | Claude API key                        |
| 6   | AG Studio trial licence                     | AG Grid website (45-day trial)                                                 | Removes the Studio watermark          |
| 7   | Render account (+ hackathon credits)        | https://render.com, connect GitHub                                             | Hosted demo                           |

**PayPal sandbox app settings:** open the app → **Features** and make sure these are ticked:
Accept payments, **Transaction Search** (needed for E4 book reconciliation), Subscriptions /
Billing, Invoicing, Disputes (read). If Transaction Search is off, Vigil still runs but skips E4.

**Anthropic:** set a **monthly spend limit** in the console (Billing → Limits) before adding the key.

---

## 2. Keys and settings for `vigil/.env`

### Required for Live mode

| Variable               | Value                                                 | Where it comes from                  |
| ---------------------- | ----------------------------------------------------- | ------------------------------------ |
| `VIGIL_MODE`           | `live`                                                | Use `replay` to run with zero keys   |
| `PAYPAL_CLIENT_ID`     | sandbox app Client ID                                 | Apps & Credentials → your app        |
| `PAYPAL_SECRET`        | sandbox app Secret                                    | Apps & Credentials → your app → Show |
| `ANTHROPIC_API_KEY`    | `sk-ant-…`                                            | Anthropic Console → API Keys         |
| `APPROVAL_HMAC_SECRET` | random, ≥ 32 characters                               | Generate (command below)             |
| `SESSION_SECRET`       | random, ≥ 32 characters, different from the one above | Generate (command below)             |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Strongly recommended

| Variable                           | Value                                             | Why                                                                                          |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `PAYPAL_SANDBOX_PERSONAL_EMAIL`    | the sandbox Personal account email                | Shown on `/judge`; used to approve seeded links                                              |
| `PAYPAL_SANDBOX_PERSONAL_PASSWORD` | its password (sandbox only, never a real account) | Same                                                                                         |
| `PAYPAL_WEBHOOK_ID`                | Webhook ID from the PayPal app                    | Real webhook settlement (see section 4). Without it, `settle_check` still settles by polling |
| `AG_STUDIO`                        | AG Studio licence key                             | Without it Studio works with a watermark                                                     |

### Optional (defaults are fine)

| Variable                                | Default                                  | Notes                                                                            |
| --------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `PAYPAL_BASE_URL`                       | `https://api-m.sandbox.paypal.com`       | Keep the sandbox                                                                 |
| `PAYPAL_SANDBOX_BUSINESS_EMAIL`         | empty                                    | For your reference only                                                          |
| `SEED_CARD_NUMBER` / `SEED_CARD_EXPIRY` | test Visa `4111111111111111` / `2030-12` | If the sandbox refuses it, the seeder falls back to approval links automatically |
| `VIGIL_MODEL_INTERACTIVE`               | `claude-sonnet-5`                        | Chat agent and Studio assistant                                                  |
| `VIGIL_MODEL_BATCH`                     | `claude-opus-5-5`                        | Triage of each new exception                                                     |
| `AI_DAILY_TOKEN_BUDGET`                 | `2000000`                                | Daily cap on Claude tokens; above it the app suggests Replay                     |
| `POLICY_PER_ACTION_CAP_USD`             | `500`                                    | Above this, approvals need the typed amount                                      |
| `POLICY_DAILY_CAP_USD`                  | `2000`                                   | Hard daily cap on money moved                                                    |
| `EXECUTION_ENABLED`                     | `true`                                   | Kill switch: `false` blocks every execution                                      |
| `ALLOW_SIMULATED_WEBHOOKS`              | `false`                                  | `true` accepts dashboard-simulated events (they never settle real proposals)     |
| `RECORD`                                | `false`                                  | `true` during one Live run to record real Replay fixtures                        |
| `DATABASE_URL`                          | empty (= local PGlite)                   | Only set for a real Postgres                                                     |
| `REDIS_URL`                             | empty (= in-memory)                      | Only set for Redis/Key Value                                                     |
| `TASK_RUNNER`                           | `inline`                                 | `render` only on Render                                                          |
| `LOG_LEVEL`                             | `info`                                   |                                                                                  |

### Minimal `.env` for a local Live run

```ini
VIGIL_MODE=live
PAYPAL_CLIENT_ID=...
PAYPAL_SECRET=...
ANTHROPIC_API_KEY=...
APPROVAL_HMAC_SECRET=...64 hex chars...
SESSION_SECRET=...another 64 hex chars...
PAYPAL_SANDBOX_PERSONAL_EMAIL=...
PAYPAL_SANDBOX_PERSONAL_PASSWORD=...
AG_STUDIO=...
```

---

## 3. First local Live run (in this order)

Locally the embedded database (`.data/pglite`) can only be opened by **one process at a time**:
keep `pnpm dev` **stopped** while running the commands in steps 1–3.

1. `pnpm install`
2. `pnpm paypal:smoke` — gets a sandbox token and creates/reads one order.
3. `pnpm seed`, then `pnpm seed` again (must create nothing new), then `pnpm seed:check`.
   If it prints approval links, open each one, log in with the sandbox **Personal** account,
   approve, then run `pnpm seed` once more.
4. `pnpm dev` → http://localhost:3000/judge → **Run detection now** → open the control room.
5. Select an exception → Approve → watch the settlement trail.

Tell Claude when the keys are in: it will run the live checks, record real Replay fixtures, and
fix anything the sandbox surfaces.

---

## 4. Webhooks (for real settlement)

PayPal must be able to reach your app over HTTPS:

- **Hosted (recommended):** after deploying, register
  `https://<your-web>.onrender.com/api/webhooks/paypal`.
- **Local:** `cloudflared tunnel --url http://localhost:3000`, then register
  `https://<random>.trycloudflare.com/api/webhooks/paypal`.

In the PayPal app → **Webhooks → Add Webhook**, subscribe to:
`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`,
`PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.REFUNDED`,
`PAYMENT.CAPTURE.REVERSED`, `PAYMENT.REFUND.FAILED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`,
`BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `CUSTOMER.DISPUTE.CREATED`,
`CUSTOMER.DISPUTE.UPDATED`.

Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID`.

---

## 5. Render (hosted demo)

Full click-by-click steps: [`deploy.md`](deploy.md). What you provide:

| Item                                         | Where                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GitHub repo connected to Render              | Render → New → Blueprint → `vigil`                                                                           |
| `RENDER_API_KEY`                             | Render → Account Settings → API Keys                                                                         |
| Secrets in the **`vigil-shared`** env group  | `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`, `ANTHROPIC_API_KEY`, `RENDER_API_KEY`, `AG_STUDIO` |
| Workflow service named **`vigil-workflows`** | Created by hand in the dashboard (Blueprints can't create it yet)                                            |

Render generates `APPROVAL_HMAC_SECRET` and `SESSION_SECRET` itself (shared by all services) and
wires `DATABASE_URL` / `REDIS_URL` from its Postgres and Key Value. Don't set those by hand.

---

## 6. For the submission (only you can do these)

- [ ] Make the GitHub repo **public** (Devpost rule), then turn on required CI checks for `main`.
- [ ] Record the video (< 3 minutes, public on YouTube, no unlicensed music); script in [`final-checklist.md`](final-checklist.md).
- [ ] Fill in Devpost from [`devpost-draft.md`](devpost-draft.md) and submit (early check by Nov 5, final by Nov 11).
- [ ] Put the sandbox buyer login on the Devpost page for judges.
- [ ] Keep the hosted demo, keys, credits and licence alive until **Dec 15** (reminders Dec 1 and Dec 10).

---

## Quick reference: what each key unlocks

| Without…                             | What happens                                                          |
| ------------------------------------ | --------------------------------------------------------------------- |
| PayPal keys                          | Live is unavailable; the app falls back to Replay and says why        |
| Anthropic key                        | Same fallback; no AI triage or chat in Live                           |
| Transaction Search on the PayPal app | E4 (books vs. PayPal) is skipped; E1–E3 still run                     |
| `PAYPAL_WEBHOOK_ID`                  | No real webhook settlement; `settle_check` settles by polling instead |
| `AG_STUDIO`                          | Studio shows a watermark                                              |
| Render account / `RENDER_API_KEY`    | No hosted URL; everything runs locally                                |
| Sandbox Personal account             | Seeded buyer-approval links can't be approved                         |
