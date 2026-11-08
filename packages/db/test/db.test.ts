import { paramsHash } from '@vigil/core';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicateOpenProposalError,
  StaleStateError,
  appendAudit,
  consumeApprovalToken,
  createTestDb,
  finishExecution,
  getApproval,
  getException,
  insertDraftProposal,
  insertWebhookEvent,
  isUniqueViolation,
  queryRows,
  recordApproval,
  reserveIdempotencyKey,
  startExecution,
  transitionException,
  transitionProposal,
  transitionWebhookEvent,
  upsertException,
  verifyChain,
  type Actor,
  type DbHandle,
} from '../src/index.js';
import { auditLog } from '../src/schema.js';

const system: Actor = { type: 'system', id: 'test' };
let handle: DbHandle;

beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(async () => {
  await handle.close();
});

async function seedException(targetRef = 'authorization:AUTH1') {
  const { exception } = await upsertException(
    handle.db,
    {
      type: 'AUTH_HONOR_EXPIRING',
      targetRef,
      amountAtRiskCents: 4800,
      currency: 'USD',
      detectorVersion: 'e3.v1',
      evidence: { authorization_id: 'AUTH1' },
    },
    system,
  );
  return exception;
}

function draft(exceptionId: string, targetRef = 'authorization:AUTH1') {
  const params = { authorization_id: 'AUTH1', amount: { currency_code: 'USD', value: '48.00' } };
  return insertDraftProposal(
    handle.db,
    {
      exceptionId,
      actionType: 'capture_authorization',
      targetRef,
      params,
      paramsHash: paramsHash(params),
      rationale: 'Honor period ends in 6h; order shipped.',
      evidenceRefs: ['AUTH1'],
      confidence: 0.9,
      amountCents: 4800,
      currency: 'USD',
    },
    { type: 'agent', id: 'run-1' },
  );
}

describe('migrations', () => {
  it('apply cleanly and are idempotent', async () => {
    await expect(handle.migrate()).resolves.toBeUndefined();
    const rows = await queryRows<{ table_name: string }>(
      handle.db,
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'agent_runs',
        'approvals',
        'audit_log',
        'exceptions',
        'executions',
        'idempotency_keys',
        'ledger_entries',
        'policies',
        'pp_authorizations',
        'pp_captures',
        'pp_orders',
        'pp_subscriptions',
        'pp_transactions',
        'proposals',
        'recordings',
        'webhook_events',
      ]),
    );
  });
});

describe('exceptions', () => {
  it('upserts by (type, target_ref) and re-opens resolved exceptions', async () => {
    const ex = await seedException();
    const again = await upsertException(
      handle.db,
      {
        type: 'AUTH_HONOR_EXPIRING',
        targetRef: 'authorization:AUTH1',
        detectorVersion: 'e3.v1',
        evidence: { refreshed: true },
      },
      system,
    );
    expect(again.created).toBe(false);
    expect(again.exception.id).toBe(ex.id);

    await transitionException(handle.db, ex.id, 'OPEN', 'DISMISSED', system);
    const reopened = await upsertException(
      handle.db,
      {
        type: 'AUTH_HONOR_EXPIRING',
        targetRef: 'authorization:AUTH1',
        detectorVersion: 'e3.v1',
        evidence: {},
      },
      system,
    );
    expect(reopened.reopened).toBe(true);
    expect((await getException(handle.db, ex.id))?.status).toBe('OPEN');
  });

  it('rejects forbidden and stale transitions', async () => {
    const ex = await seedException();
    await expect(transitionException(handle.db, ex.id, 'OPEN', 'RESOLVED', system)).rejects.toThrow(
      /Invalid exception transition/,
    );
    await transitionException(handle.db, ex.id, 'OPEN', 'TRIAGING', system);
    await expect(
      transitionException(handle.db, ex.id, 'OPEN', 'TRIAGING', system),
    ).rejects.toBeInstanceOf(StaleStateError);
  });
});

describe('proposals', () => {
  it('allows only one open proposal per target', async () => {
    const ex = await seedException();
    await draft(ex.id);
    await expect(draft(ex.id)).rejects.toBeInstanceOf(DuplicateOpenProposalError);
  });

  it('allows a new proposal once the previous one is closed', async () => {
    const ex = await seedException();
    const p = await draft(ex.id);
    await transitionProposal(handle.db, p.id, 'DRAFT', 'POLICY_REJECTED', {
      type: 'policy',
      id: 'v1',
    });
    await expect(draft(ex.id)).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('enforces the rationale length check in the database', async () => {
    const ex = await seedException();
    await expect(
      insertDraftProposal(
        handle.db,
        {
          exceptionId: ex.id,
          actionType: 'dismiss',
          targetRef: 'x',
          params: {},
          paramsHash: paramsHash({}),
          rationale: 'x'.repeat(601),
          evidenceRefs: ['x'],
          confidence: 0.5,
        },
        system,
      ),
    ).rejects.toThrow();
  });
});

describe('approvals', () => {
  it('records one decision per proposal and a single-use token', async () => {
    const ex = await seedException();
    const p = await draft(ex.id);
    const input = {
      proposalId: p.id,
      decision: 'APPROVED' as const,
      approver: 'judge-1',
      paramsHash: p.paramsHash,
      tokenHash: 'a'.repeat(64),
    };
    await recordApproval(handle.db, input, { type: 'human', id: 'judge-1' });
    await expect(
      recordApproval(handle.db, { ...input, decision: 'REJECTED' }, system),
    ).rejects.toSatisfy((e) => isUniqueViolation(e, 'approvals_proposal_uq'));

    expect(await consumeApprovalToken(handle.db, p.id, 'b'.repeat(64))).toBe(false);
    expect(await consumeApprovalToken(handle.db, p.id, 'a'.repeat(64))).toBe(true);
    expect(await consumeApprovalToken(handle.db, p.id, 'a'.repeat(64))).toBe(false);
    expect((await getApproval(handle.db, p.id))?.tokenUsedAt).toBeInstanceOf(Date);
  });
});

describe('executions', () => {
  it('rejects a duplicate (proposal, attempt)', async () => {
    const ex = await seedException();
    const p = await draft(ex.id);
    const base = { proposalId: p.id, operation: 'authorization.capture', endpoint: '/v2/x' };
    const e1 = await startExecution(handle.db, { ...base, attempt: 1, paypalRequestId: 'req-1' });
    await finishExecution(handle.db, e1.id, { httpStatus: 201, paypalStatus: 'COMPLETED' });
    await expect(startExecution(handle.db, { ...base, attempt: 1 })).rejects.toSatisfy((e) =>
      isUniqueViolation(e, 'executions_proposal_attempt_uq'),
    );
  });
});

describe('idempotency keys', () => {
  it('returns the stored key on retry and refuses a different body', async () => {
    const input = {
      operation: 'authorization.capture',
      businessKey: 'proposal-1',
      paypalRequestId: '11111111-1111-5111-8111-111111111111',
      requestHash: 'a'.repeat(64),
      retentionUntil: new Date(Date.now() + 6 * 3600_000),
    };
    const first = await reserveIdempotencyKey(handle.db, input);
    const retry = await reserveIdempotencyKey(handle.db, {
      ...input,
      paypalRequestId: '22222222-2222-5222-8222-222222222222',
    });
    expect(retry.paypalRequestId).toBe(first.paypalRequestId);
    await expect(
      reserveIdempotencyKey(handle.db, { ...input, requestHash: 'b'.repeat(64) }),
    ).rejects.toThrow(/different request body/);
  });
});

describe('webhook events', () => {
  it('dedupes on event_id and follows the state machine', async () => {
    const input = {
      eventId: 'WH-1',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      rawBody: new TextEncoder().encode('{"id":"WH-1"}'),
    };
    expect(await insertWebhookEvent(handle.db, input)).not.toBeNull();
    expect(await insertWebhookEvent(handle.db, input)).toBeNull();
    await transitionWebhookEvent(handle.db, 'WH-1', 'RECEIVED', 'VERIFIED');
    await expect(transitionWebhookEvent(handle.db, 'WH-1', 'VERIFIED', 'RECEIVED')).rejects.toThrow(
      /Invalid webhook_event transition/,
    );
    const done = await transitionWebhookEvent(handle.db, 'WH-1', 'VERIFIED', 'PROCESSED');
    expect(done.processedAt).toBeInstanceOf(Date);
    expect(Buffer.from(done.rawBody).toString()).toBe('{"id":"WH-1"}');
  });
});

describe('audit log', () => {
  it('chains every write and verifies', async () => {
    const ex = await seedException();
    await transitionException(handle.db, ex.id, 'OPEN', 'TRIAGING', system);
    await draft(ex.id);
    const result = await verifyChain(handle.db);
    expect(result).toMatchObject({ ok: true, rows: 3 });
  });

  it('serialises concurrent appends into one chain', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        appendAudit(handle.db, {
          actorType: 'system',
          actorId: 't',
          action: 'test',
          entityType: 'x',
          entityId: String(i),
          payload: { i, nested: { b: 1, a: 2 } },
        }),
      ),
    );
    expect(await verifyChain(handle.db)).toMatchObject({ ok: true, rows: 10 });
  });

  it('blocks UPDATE, DELETE and TRUNCATE', async () => {
    await seedException();
    await expect(handle.db.update(auditLog).set({ action: 'forged' })).rejects.toThrow();
    await expect(handle.db.delete(auditLog)).rejects.toThrow();
    await expect(handle.db.execute(sql`truncate audit_log`)).rejects.toThrow();
    const cause = await handle.db
      .update(auditLog)
      .set({ action: 'forged' })
      .catch((e: Error) => e);
    expect(String((cause as Error & { cause?: Error }).cause ?? cause)).toMatch(/append-only/);
  });

  it('detects a tampered row', async () => {
    const ex = await seedException();
    await transitionException(handle.db, ex.id, 'OPEN', 'TRIAGING', system);
    await transitionException(handle.db, ex.id, 'TRIAGING', 'ESCALATED', system);
    // Simulate an attacker with superuser rights who bypasses the trigger.
    await handle.db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`);
    await handle.db.execute(
      sql`update audit_log set payload = '{"from":"OPEN","to":"RESOLVED"}'::jsonb where seq = 2`,
    );
    expect(await verifyChain(handle.db)).toMatchObject({
      ok: false,
      brokenAtSeq: 2,
      reason: 'hash_mismatch',
    });
  });

  it('detects a deleted row', async () => {
    const ex = await seedException();
    await transitionException(handle.db, ex.id, 'OPEN', 'TRIAGING', system);
    await transitionException(handle.db, ex.id, 'TRIAGING', 'ESCALATED', system);
    await handle.db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`);
    await handle.db.execute(sql`delete from audit_log where seq = 2`);
    expect(await verifyChain(handle.db)).toMatchObject({
      ok: false,
      brokenAtSeq: 3,
      reason: 'prev_hash_mismatch',
    });
  });
});

describe('recordings fixture store', () => {
  it('round-trips a recording', async () => {
    const { createDbFixtureStore } = await import('../src/recordings.js');
    const store = createDbFixtureStore(handle.db);
    const rec = {
      key: 'c'.repeat(64),
      kind: 'paypal' as const,
      request: { method: 'GET', url: '/v2/x', body: null },
      response: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
      recordedAt: '2026-11-02T00:00:00.000Z',
    };
    expect(await store.get('paypal', rec.key)).toBeNull();
    await store.put(rec);
    await store.put(rec);
    expect(await store.get('paypal', rec.key)).toEqual(rec);
    expect(await store.get('llm', rec.key)).toBeNull();
  });
});
