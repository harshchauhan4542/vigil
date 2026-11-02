import { paramsHash } from '@vigil/core';
import {
  createTestDb,
  getProposal,
  insertDraftProposal,
  upsertAuthorization,
  upsertException,
  type DbHandle,
} from '@vigil/db';
import { MemoryCache, createPayPalClient, type PayPalHttp } from '@vigil/paypal';
import { InlineTaskRunner, TASK_NAMES, type TaskHandlers } from '@vigil/tasks';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freshStateFor, parseTargetRef } from '../src/fresh.js';
import {
  approveProposal,
  evaluateDraft,
  evidenceUniverse,
  rejectProposal,
  type GateDeps,
} from '../src/gate.js';

const PP = 'https://api-m.sandbox.paypal.com';
const NOW = new Date('2026-11-05T12:00:00Z');
const server = setupServer();
let handle: DbHandle;
let paypal: PayPalHttp;
let authStatus = 'CREATED';
const started: unknown[][] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  authStatus = 'CREATED';
  started.length = 0;
  handle = await createTestDb();
  server.use(
    http.post(`${PP}/v1/oauth2/token`, () =>
      HttpResponse.json({ access_token: 'T', token_type: 'Bearer', expires_in: 32400 }),
    ),
    http.get(`${PP}/v2/payments/authorizations/:id`, ({ params }) =>
      params.id === 'GONE'
        ? HttpResponse.json({ name: 'RESOURCE_NOT_FOUND', debug_id: 'd404' }, { status: 404 })
        : HttpResponse.json({
            id: params.id,
            status: authStatus,
            amount: { currency_code: 'USD', value: '48.00' },
            create_time: '2026-11-03T00:00:00Z',
          }),
    ),
    http.get(`${PP}/v2/payments/captures/:id`, ({ params }) =>
      HttpResponse.json({
        id: params.id,
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: '21.50' },
      }),
    ),
    http.get(`${PP}/v1/customer/disputes`, () =>
      HttpResponse.json({ name: 'NOT_AUTHORIZED' }, { status: 403 }),
    ),
  );
  ({ http: paypal } = await createPayPalClient({
    clientId: 'c',
    secret: 's',
    baseUrl: PP,
    cache: new MemoryCache(),
    sleep: async () => {},
  }));
});
afterEach(async () => {
  server.resetHandlers();
  await handle.close();
});

function deps(over: Partial<GateDeps> = {}): GateDeps {
  const runner = new InlineTaskRunner().register(
    Object.fromEntries(
      TASK_NAMES.map((n) => [n, async (...a: unknown[]) => void started.push([n, ...a])]),
    ) as TaskHandlers,
  );
  return {
    db: handle.db,
    http: paypal,
    runner,
    approvalSecret: 'x'.repeat(40),
    executionEnabled: true,
    now: () => NOW,
    ...over,
  };
}

async function draft(value = '48.00') {
  const { exception } = await upsertException(
    handle.db,
    {
      type: 'AUTH_HONOR_EXPIRING',
      targetRef: 'authorization:AUTH1',
      detectorVersion: 'e3.v1',
      evidence: { authorization_id: 'AUTH1', order_id: 'O1' },
    },
    { type: 'detector', id: 't' },
  );
  const params = {
    authorization_id: 'AUTH1',
    amount: { currency_code: 'USD', value },
    final_capture: true,
  };
  const p = await insertDraftProposal(
    handle.db,
    {
      exceptionId: exception.id,
      actionType: 'capture_authorization',
      targetRef: 'authorization:AUTH1',
      params,
      paramsHash: paramsHash(params),
      rationale: 'r',
      evidenceRefs: ['AUTH1'],
      confidence: 0.9,
    },
    { type: 'agent', id: 'run' },
  );
  return { exception, p };
}

describe('fresh state', () => {
  it('reads the authorization live and the captured total from the mirror', async () => {
    await upsertAuthorization(handle.db, {
      id: 'AUTH1',
      status: 'PARTIALLY_CAPTURED',
      amountCents: 4800,
      currency: 'USD',
      capturedTotalCents: 1000,
    });
    expect(
      await freshStateFor(handle.db, paypal, 'capture_authorization', 'authorization:AUTH1'),
    ).toMatchObject({
      kind: 'authorization',
      status: 'CREATED',
      amountCents: 4800,
      capturedCents: 1000,
    });
  });

  it('a 404 becomes unavailable with the debug id; internal actions need no state', async () => {
    expect(
      await freshStateFor(handle.db, paypal, 'void_authorization', 'authorization:GONE'),
    ).toMatchObject({
      kind: 'unavailable',
      reason: expect.stringContaining('d404'),
    });
    expect(await freshStateFor(handle.db, paypal, 'dismiss', 'txn:TX1')).toEqual({ kind: 'none' });
  });

  it('a disputes API without permission does not block (refund error is the backstop)', async () => {
    expect(await freshStateFor(handle.db, paypal, 'refund', 'capture:CAP1')).toMatchObject({
      kind: 'capture',
      disputed: false,
    });
  });

  it('parses target refs', () => {
    expect(parseTargetRef('capture:ABC')).toEqual({ kind: 'capture', id: 'ABC' });
  });
});

describe('evidence universe', () => {
  it('collects ids from nested evidence plus exception and target ids', () => {
    const u = evidenceUniverse({
      id: 'ex-1',
      targetRef: 'txn:TX1',
      evidence: {
        transaction_id: 'TX1',
        refs: ['INV-1'],
        ledger_entry_id: 'L-1',
        memo: 'two words',
        cents: 100,
      },
    });
    expect(u).toEqual(expect.arrayContaining(['ex-1', 'TX1', 'INV-1', 'L-1']));
    expect(u).not.toContain('two words');
  });
});

describe('evaluate and approve', () => {
  it('moves a passing DRAFT to PENDING_APPROVAL with an expiry and the checklist', async () => {
    const { p } = await draft();
    const r = await evaluateDraft(deps(), p.id);
    expect(r?.verdict).toBe('PASS');
    expect(await getProposal(handle.db, p.id)).toMatchObject({
      status: 'PENDING_APPROVAL',
      riskTier: 2,
      policyVersion: 'policy.v1',
    });
  });

  it('approve queues execute_proposal with a token and locks the target', async () => {
    const { p } = await draft();
    await evaluateDraft(deps(), p.id);
    const r = await approveProposal(deps(), { proposalId: p.id, approver: 'judge' });
    expect(r).toMatchObject({ ok: true, status: 'QUEUED' });
    expect(started).toEqual([['execute_proposal', p.id, expect.stringMatching(/^v1\./)]]);

    // While it is queued, the target is locked: no second open proposal (R6 / unique index).
    await expect(draft()).rejects.toThrow(/open proposal already exists/);
  });

  it('expired proposals cannot be approved', async () => {
    const { p } = await draft();
    await evaluateDraft(deps(), p.id);
    const later = deps({ now: () => new Date(NOW.getTime() + 3 * 3_600_000) });
    expect(await approveProposal(later, { proposalId: p.id, approver: 'j' })).toMatchObject({
      ok: false,
      code: 'expired',
    });
    expect((await getProposal(handle.db, p.id))?.status).toBe('EXPIRED');
  });

  it('re-checks PayPal at approval: a hold captured meanwhile can no longer be approved', async () => {
    const { p } = await draft();
    await evaluateDraft(deps(), p.id);
    authStatus = 'CAPTURED';
    const r = await approveProposal(deps(), { proposalId: p.id, approver: 'j' });
    expect(r).toMatchObject({ ok: false, code: 'policy_failed' });
    expect(started).toEqual([]);
  });

  it('kill switch: nothing passes when execution is disabled', async () => {
    const { p } = await draft();
    const r = await evaluateDraft(deps({ executionEnabled: false }), p.id);
    expect(r?.verdict).toBe('FAIL');
    expect((await getProposal(handle.db, p.id))?.status).toBe('POLICY_REJECTED');
  });

  it('reject is final', async () => {
    const { p } = await draft();
    await evaluateDraft(deps(), p.id);
    expect(await rejectProposal(deps(), { proposalId: p.id, approver: 'j', reason: 'no' })).toEqual(
      { ok: true, status: 'REJECTED' },
    );
    expect(await approveProposal(deps(), { proposalId: p.id, approver: 'j' })).toMatchObject({
      ok: false,
      code: 'not_pending',
    });
  });
});
