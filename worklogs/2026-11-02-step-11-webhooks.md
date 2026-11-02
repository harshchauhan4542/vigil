# 2026-11-02 — Step 11: Webhooks and settlement

**Session goal:** PayPal's own confirmation closes the loop.
**Result:** 🟡 Code done and tested with fixture events + a test certificate; a real sandbox webhook waits on keys and a public URL
**Branch / commit:** `step-11-webhooks`

## What was done

- `packages/paypal/src/webhooks-verify.ts`: transmission headers, `signedMessage` (`id|time|webhook_id|crc32` with Node's `zlib.crc32`, decimal unsigned), `isPayPalCertUrl` (HTTPS + `*.paypal.com` only), `CertCache`, `selfVerify` (SHA256withRSA via `X509Certificate`), `postbackVerify` (event posted back **byte-for-byte** using the new `rawJsonBody` option in `http.ts`), `verifyWebhook` (postback → self → simulator rule).
- `packages/gate/src/webhooks.ts` `receiveWebhook`: store raw bytes first → dedupe on event id (duplicates get 200 and nothing else) → verify → `VERIFIED` / `REJECTED` (400) → start `process_webhook`.
- `apps/workflows/src/tasks/process-webhook.ts`: re-GET the resource before any change; settle only `SUCCEEDED` proposals whose execution touched that resource and whose current PayPal status confirms the action; simulated events are audited and never settle; authorization events refresh the mirror.
- `@vigil/db`: `findProposalsByResource`; `simulated` settable on webhook transitions. `@vigil/tasks`: `process_webhook` task.
- `fixtures/webhooks/`: self-signed test-only certificate + key (README says so).

## Checks

| Check                                                                   | Result                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| lint / typecheck / test / build                                         | ✅ (paypal +8, workflows +5)                                                              |
| Valid signature passes; tampered body / bad signature fail              | ✅                                                                                        |
| Duplicates ignored                                                      | ✅                                                                                        |
| Simulated event can't settle a real proposal                            | ✅                                                                                        |
| Out-of-order: event says COMPLETED, PayPal says PENDING → no settlement | ✅                                                                                        |
| Real sandbox capture → real webhook settles it                          | ⏳ needs keys + `PAYPAL_WEBHOOK_ID` + a public URL (tunnel locally, or Render in Step 14) |

## Decisions and deviations from the plan

- I did not install `cloudflared` on your machine; the local tunnel command is in `docs/deploy.md` (Step 14). The hosted Render URL is the simpler path.

## Left over / next

- Next: Step 12, Web app API routes.

## Needs from the user

- `PAYPAL_WEBHOOK_ID` once the webhook is registered (Step 14 gives the steps).
