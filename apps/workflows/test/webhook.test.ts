import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { paramsHash } from '@vigil/core';
import {
  finishExecution,
  getException,
  getProposal,
  getWebhookEvent,
  insertDraftProposal,
  startExecution,
  transitionException,
  transitionProposal,
  upsertException,
} from '@vigil/db';
import { receiveWebhook, type ReceiveDeps } from '@vigil/gate';
import { CertCache, SIMULATOR_WEBHOOK_ID, signedMessage } from '@vigil/paypal';
import { POLICY_V1 } from '@vigil/policy';
import { InlineTaskRunner } from '@vigil/tasks';
import { describe, expect, it } from 'vitest';
import type { WorkflowContext } from '../src/context.js';
import { buildHandlers } from '../src/tasks/index.js';
import { useTestEnv } from './helpers.js';

const env = useTestEnv();
const CERT = readFileSync(
  new URL('../../../fixtures/webhooks/test-cert.pem', import.meta.url),
  'utf8',
);
const KEY = readFileSync(
  new URL('../../../fixtures/webhooks/test-key.pem', import.meta.url),
  'utf8',
);
const WEBHOOK_ID = 'WH-ID-TEST';
const sys = { type: 'system', id: 't' } as const;

function setup() {
  const runner = new InlineTaskRunner();
  const ctx: WorkflowContext = {
    db: env.handle.db,
    http: env.http,
    runner,
    approvalSecret: 'x'.repeat(40),
    executionEnabled: true,
    policy: POLICY_V1,
    triage: null,
    maxAttempts: 3,
    now: () => new Date(),
    sleep: async () => {},
    log: () => {},
  };
  runner.register(buildHandlers(async () => ctx));
  const deps: ReceiveDeps = {
    db: env.handle.db,
    http: env.http,
    runner,
    certs: new CertCache(async () => new Response(CERT)),
    webhookId: WEBHOOK_ID,
    allowSimulated: true,
    postback: false,
  };
  return { ctx, deps };
}

/** A proposal that captured CAP-9 and is waiting for settlement. */
async function succeededCapture() {
  env.fake.addCapture('CAP-9', 4800);
  const { exception } = await upsertException(
    env.handle.db,
    {
      type: 'AUTH_HONOR_EXPIRING',
      targetRef: 'authorization:A9',
      detectorVersion: 'e3.v1',
      evidence: { authorization_id: 'A9' },
    },
    sys,
  );
  for (const [from, to] of [
    ['OPEN', 'TRIAGING'],
    ['TRIAGING', 'PROPOSED'],
    ['PROPOSED', 'AWAITING_APPROVAL'],
    ['AWAITING_APPROVAL', 'EXECUTING'],
    ['EXECUTING', 'AWAITING_SETTLEMENT'],
  ] as const) {
    await transitionException(env.handle.db, exception.id, from, to, sys);
  }
  const params = {
    authorization_id: 'A9',
    amount: { currency_code: 'USD', value: '48.00' },
    final_capture: true,
  };
  const p = await insertDraftProposal(
    env.handle.db,
    {
      exceptionId: exception.id,
      actionType: 'capture_authorization',
      targetRef: 'authorization:A9',
      params,
      paramsHash: paramsHash(params),
      rationale: 'r',
      evidenceRefs: ['A9'],
      confidence: 1,
    },
    sys,
  );
  for (const [from, to] of [
    ['DRAFT', 'PENDING_APPROVAL'],
    ['PENDING_APPROVAL', 'APPROVED'],
    ['APPROVED', 'QUEUED'],
    ['QUEUED', 'EXECUTING'],
    ['EXECUTING', 'SUCCEEDED'],
  ] as const) {
    await transitionProposal(env.handle.db, p.id, from, to, sys);
  }
  const x = await startExecution(env.handle.db, {
    proposalId: p.id,
    attempt: 1,
    operation: 'authorizations.capture',
    endpoint: '/x',
  });
  await finishExecution(env.handle.db, x.id, {
    httpStatus: 201,
    paypalStatus: 'COMPLETED',
    response: { id: 'CAP-9', status: 'COMPLETED' },
  });
  return { exception, p };
}

function signed(event: object, webhookId = WEBHOOK_ID) {
  const raw = new TextEncoder().encode(JSON.stringify(event));
  const t = {
    transmissionId: crypto.randomUUID(),
    transmissionTime: new Date().toISOString(),
    transmissionSig: '',
    certUrl: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test',
    authAlgo: 'SHA256withRSA',
  };
  const sig = sign('sha256', Buffer.from(signedMessage(t, webhookId, raw)), KEY).toString('base64');
  const headers = new Headers({
    'paypal-transmission-id': t.transmissionId,
    'paypal-transmission-time': t.transmissionTime,
    'paypal-transmission-sig': sig,
    'paypal-cert-url': t.certUrl,
    'paypal-auth-algo': t.authAlgo,
    'content-type': 'application/json',
  });
  return { raw, headers };
}

const captureCompleted = (id = 'WH-1') => ({
  id,
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource_type: 'capture',
  resource: { id: 'CAP-9', status: 'COMPLETED' },
});

describe('webhook → settlement', () => {
  it('a verified event re-reads the capture and settles the proposal; the exception resolves', async () => {
    const { deps } = setup();
    const { exception, p } = await succeededCapture();
    const { raw, headers } = signed(captureCompleted());
    const r = await receiveWebhook(deps, raw, headers);
    expect(r).toEqual({ status: 200, body: { ok: true, event_id: 'WH-1', simulated: false } });
    expect((await getProposal(env.handle.db, p.id))?.status).toBe('SETTLED');
    expect((await getException(env.handle.db, exception.id))?.status).toBe('RESOLVED');
    const ev = await getWebhookEvent(env.handle.db, 'WH-1');
    expect(ev).toMatchObject({
      processingStatus: 'PROCESSED',
      verificationMethod: 'self',
      simulated: false,
    });
    expect(Buffer.from(ev!.rawBody).equals(Buffer.from(raw))).toBe(true);
  });

  it('duplicates are acknowledged and ignored', async () => {
    const { deps } = setup();
    await succeededCapture();
    const { raw, headers } = signed(captureCompleted());
    await receiveWebhook(deps, raw, headers);
    const again = await receiveWebhook(deps, raw, headers);
    expect(again).toMatchObject({ status: 200, body: { duplicate: true } });
  });

  it('a bad signature is rejected (400) and never processed', async () => {
    const { deps } = setup();
    const { p } = await succeededCapture();
    const { headers } = signed(captureCompleted());
    const tampered = new TextEncoder().encode(
      JSON.stringify({ ...captureCompleted(), resource: { id: 'CAP-9', status: 'REFUNDED' } }),
    );
    const r = await receiveWebhook(deps, tampered, headers);
    expect(r.status).toBe(400);
    expect((await getWebhookEvent(env.handle.db, 'WH-1'))?.processingStatus).toBe('REJECTED');
    expect((await getProposal(env.handle.db, p.id))?.status).toBe('SUCCEEDED');
  });

  it('a simulated event (WEBHOOK_ID) is stored as simulated and cannot settle a real proposal', async () => {
    const { deps } = setup();
    const { p } = await succeededCapture();
    const { raw, headers } = signed(captureCompleted('WH-SIM'), SIMULATOR_WEBHOOK_ID);
    const r = await receiveWebhook(deps, raw, headers);
    expect(r.body).toMatchObject({ ok: true, simulated: true });
    expect((await getProposal(env.handle.db, p.id))?.status).toBe('SUCCEEDED');
    expect((await getWebhookEvent(env.handle.db, 'WH-SIM'))?.processingStatus).toBe('PROCESSED');
  });

  it('out-of-order safety: the event says COMPLETED but PayPal now says PENDING → no settlement', async () => {
    const { deps } = setup();
    const { p } = await succeededCapture();
    env.fake.captures.get('CAP-9')!.status = 'PENDING';
    const { raw, headers } = signed(captureCompleted());
    await receiveWebhook(deps, raw, headers);
    expect((await getProposal(env.handle.db, p.id))?.status).toBe('SUCCEEDED');
  });
});
