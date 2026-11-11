# Deploying Vigil to Render

Everything except the Workflow service comes from `render.yaml`. Secrets are typed into the
Render dashboard only; they never go into git or chat.

## 0. Before you start

- The GitHub repo must be **public** before submission (Devpost rule). Render can deploy a private repo once you connect GitHub.
- You need: a Render account (claim the hackathon credits), a PayPal **sandbox** app (Client ID + Secret), an Anthropic API key with a monthly spend limit, and (optional) the AG Studio licence key.

## 1. Blueprint (web, Postgres, Key Value, crons, shared env group)

1. Render dashboard → **New → Blueprint** → pick the `vigil` repo → branch `main`.
2. Render reads `render.yaml` and shows: `vigil-db` (Postgres 16), `vigil-kv` (Key Value), `vigil-web`, `vigil-detect` (every 15 min), `vigil-nightly-reseed` (02:30 UTC = 08:00 IST), and the env group **`vigil-shared`**.
3. When asked for the `sync: false` values, paste: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `ANTHROPIC_API_KEY`, `AG_STUDIO` (optional). Leave `PAYPAL_WEBHOOK_ID` and `RENDER_API_KEY` empty for now (steps 3 and 4).
4. **Apply**. `APPROVAL_HMAC_SECRET` and `SESSION_SECRET` are generated once, in the group, so every service shares them (the web app mints approval tokens; the workflow service verifies them).
5. Wait for `vigil-web` to go live. Open `https://<your-web>.onrender.com/api/health`: you'll see `"mode":"replay"` with a `fallback` reason until all Live settings are in place. That's expected.

Database migrations run automatically on boot (every service calls `migrate()`).

## 2. Workflow service (dashboard only)

Render Workflows can't be declared in a Blueprint yet.

1. **New → Workflow**, same repo and branch.
2. **Name: `vigil-workflows`** (the web app starts tasks as `vigil-workflows/<task>`).
3. Runtime Node. **Build command:** `npm install -g pnpm@10.34.9 && pnpm install --frozen-lockfile && pnpm turbo run build --filter=@vigil/workflows`
4. **Start command:** `node apps/workflows/dist/worker.js`
5. **Environment:** link the **`vigil-shared`** group, then add `DATABASE_URL` (copy the _Internal_ connection string from `vigil-db`) and `REDIS_URL` (Internal URL from `vigil-kv`).
6. Create. The worker registers 7 tasks: `detect_exceptions`, `triage_exception`, `execute_proposal`, `settle_check`, `process_webhook`, `reconcile_window`, `reseed_demo`.

## 3. Render API key (so web + cron can start tasks)

1. Account settings → **API Keys → Create**.
2. Paste it into the `vigil-shared` group as `RENDER_API_KEY` → save (services redeploy).

## 4. PayPal webhook

1. developer.paypal.com → Apps & Credentials → **Sandbox** → your app → **Webhooks → Add Webhook**.
2. URL: `https://<your-web>.onrender.com/api/webhooks/paypal`
3. Events: `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.REFUND.FAILED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`.
4. Copy the **Webhook ID** → paste into `vigil-shared` as `PAYPAL_WEBHOOK_ID`.

`/api/health` should now show `"mode":"live"` and no `fallback`.

## 5. Seed, record, verify

1. In the `vigil-workflows` service → **Shell** (or locally with the same env): `pnpm seed`, then `pnpm seed` again (no duplicates), then `pnpm seed:check`.
2. Approve any pending buyer links with the sandbox Personal account if the seeder printed them (spike S2).
3. Record replay fixtures once: run one full flow with `RECORD=true` set on the services, then set it back to `false`. Recordings land in the `recordings` table (and, locally, in `fixtures/recordings/` to commit).
4. Walk the flow: `BASE=https://<your-web>.onrender.com scripts/api-walkthrough.sh`, or click through `/control-room`: select an exception → Approve → watch it reach SETTLED when the PayPal webhook arrives.
5. Switch to Replay in the top bar and repeat: no external calls are made.

## Auto-fallback

If Live can't start (missing or invalid keys, bad config), the web app serves **Replay** and says why in the banner and in `/api/health` (`fallback.reason`); it retries Live every 5 minutes. While in fallback, the webhook endpoint returns 503 so PayPal retries later (it retries for up to 3 days). The AI daily token budget (`AI_DAILY_TOKEN_BUDGET`) returns 429 with a "switch to Replay" hint when spent.

## Local webhooks (optional)

To receive real sandbox webhooks on your laptop instead of Render: install `cloudflared`, run `pnpm dev`, then `cloudflared tunnel --url http://localhost:3000` and register `https://<random>.trycloudflare.com/api/webhooks/paypal` as an extra webhook in the PayPal app (use its own Webhook ID in your local `.env`).

## Notes

- `audit_log` is append-only by trigger. On Render the app user owns the tables, so a `REVOKE UPDATE, DELETE` on the owner would not hold; the trigger is the enforcement, and `/api/audit` re-verifies the hash chain.
- Cost guardrails: per-IP rate limits on approve/reject/agent/reset, the daily AI token budget, and policy caps ($500 per action → T3 typed confirmation; $2,000 per day).

## Local Live runs: one process owns the embedded database

Locally (no `DATABASE_URL`) Vigil uses PGlite in `.data/pglite`, which only one process may open
at a time. Run `pnpm seed`, `pnpm seed:check` and `pnpm flow` **while `pnpm dev` is stopped**, or
keep `pnpm dev` running and use `/judge` → **Run detection now** instead of `pnpm flow`.
On Render (Postgres) there's no such limit.
