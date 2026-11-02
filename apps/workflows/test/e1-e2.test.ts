// E1 (failed renewal → retry outstanding balance) and E2 (untracked capture → add tracking),
// end to end on PGlite with the fake PayPal and a scripted fake Claude.
import { createClaudeClient, triageException } from '@vigil/agent';
import { FakeClaude, toolResults, type FakeScript } from '@vigil/agent/testing';
import {
  getException,
  getProposal,
  insertCustomerNote,
  listExceptions,
  listProposalsForException,
  upsertSeedObject,
} from '@vigil/db';
import { approveProposal } from '@vigil/gate';
import { POLICY_V1 } from '@vigil/policy';
import { MemoryFixtureStore } from '@vigil/replay';
import { InlineTaskRunner } from '@vigil/tasks';
import { describe, expect, it } from 'vitest';
import { gateDeps, type WorkflowContext } from '../src/context.js';
import { buildHandlers } from '../src/tasks/index.js';
import { useTestEnv } from './helpers.js';

const env = useTestEnv();
const NOW = new Date();

function makeCtx(script: FakeScript) {
  const claude = new FakeClaude(script);
  env.server.use(claude.handler());
  const client = createClaudeClient({
    mode: 'live',
    apiKey: 'fake-anthropic-test',
    store: new MemoryFixtureStore(),
  });
  const runner = new InlineTaskRunner();
  const ctx: WorkflowContext = {
    db: env.handle.db,
    http: env.http,
    runner,
    approvalSecret: 'approval-secret-for-tests-0123456789abcdef',
    executionEnabled: true,
    policy: POLICY_V1,
    triage: (id) =>
      triageException(
        {
          client,
          db: env.handle.db,
          http: env.http,
          model: 'claude-opus-5-5',
          mode: 'live',
          policyLimits: {},
        },
        id,
      ),
    maxAttempts: 3,
    now: () => NOW,
    sleep: async () => {},
    log: () => {},
  };
  runner.register(buildHandlers(async () => ctx));
  return { ctx, runner, claude };
}

const exId = (req: Parameters<FakeScript>[0]) =>
  /Triage exception ([0-9a-f-]{36})/.exec(String(req.messages[0]!.content))![1]!;

describe('E2 untracked capture → add tracking', () => {
  async function seedCapture() {
    env.fake.addCapture('CAP-7', 8900, {
      create_time: new Date(NOW.getTime() - 30 * 3_600_000).toISOString(),
      supplementary_data: { related_ids: { order_id: 'ORD-7' } },
    });
    env.fake.addOrder('ORD-7', 'CAP-7', 8900);
    await upsertSeedObject(env.handle.db, {
      seedKey: 'cap:7',
      kind: 'order_capture',
      paypalId: 'ORD-7',
      status: 'COMPLETED',
      data: { capture_id: 'CAP-7' },
    });
    await insertCustomerNote(env.handle.db, {
      id: '00000000-0000-4000-8000-0000000000c7',
      source: 'warehouse',
      externalRef: 'CAP-7',
      body: 'Shipped today with UPS, tracking 1Z999AA10123456784.',
    });
  }

  const script: FakeScript = (req) => {
    const r = toolResults(req);
    if (r.length === 0)
      return {
        content: [{ type: 'tool_use', name: 'get_exception', input: { exception_id: exId(req) } }],
      };
    if (r.length === 1)
      return { content: [{ type: 'tool_use', name: 'get_order', input: { order_id: 'ORD-7' } }] };
    if (r.length === 2)
      return {
        content: [
          {
            type: 'tool_use',
            name: 'propose_add_tracking',
            input: {
              order_id: 'ORD-7',
              capture_id: 'CAP-7',
              tracking_number: '1Z999AA10123456784',
              carrier: 'UPS',
              notify_payer: true,
              evidence_refs: ['CAP-7', 'ORD-7'],
              rationale: 'Shipped with UPS per the warehouse note; the order has no tracker yet.',
              confidence: 0.85,
            },
          },
        ],
      };
    return { content: [{ type: 'text', text: 'Proposed adding UPS tracking.' }] };
  };

  it('detects, proposes (T1), executes once via Orders /track, and the exception clears', async () => {
    await seedCapture();
    const { ctx, runner } = makeCtx(script);
    await runner.start('detect_exceptions', []);
    const ex = (await listExceptions(env.handle.db)).find((e) => e.type === 'UNTRACKED_CAPTURE')!;
    expect(ex).toMatchObject({ targetRef: 'capture:CAP-7', status: 'AWAITING_APPROVAL' });
    const [p] = await listProposalsForException(env.handle.db, ex.id);
    expect(p).toMatchObject({
      actionType: 'add_tracking',
      status: 'PENDING_APPROVAL',
      riskTier: 1,
    });

    expect(
      await approveProposal(gateDeps(ctx), { proposalId: p!.id, approver: 'judge' }),
    ).toMatchObject({ ok: true });
    expect((await getProposal(env.handle.db, p!.id))?.status).toBe('SUCCEEDED');
    expect(env.fake.effects.filter((e) => e.op === 'orders.track')).toHaveLength(1);
    expect(env.fake.orders.get('ORD-7')!.purchase_units[0].shipping.trackers).toHaveLength(1);

    // The next sweep sees the tracker, and settle_check closes the loop.
    await runner.start('settle_check', []);
    expect((await getException(env.handle.db, ex.id))?.status).toBe('RESOLVED');
  });
});

describe('E1 failed renewal → retry outstanding balance', () => {
  async function seedSub(outstandingCents: number) {
    env.fake.addSubscription('I-SUB1', outstandingCents);
    await upsertSeedObject(env.handle.db, {
      seedKey: 'sub:1',
      kind: 'subscription',
      paypalId: 'I-SUB1',
      status: 'ACTIVE',
    });
  }

  const script =
    (value: string): FakeScript =>
    (req) => {
      const r = toolResults(req);
      if (r.length === 0)
        return {
          content: [
            { type: 'tool_use', name: 'get_exception', input: { exception_id: exId(req) } },
          ],
        };
      if (r.length === 1)
        return {
          content: [
            { type: 'tool_use', name: 'get_subscription', input: { subscription_id: 'I-SUB1' } },
          ],
        };
      if (r.length === 2)
        return {
          content: [
            {
              type: 'tool_use',
              name: 'propose_retry_outstanding_balance',
              input: {
                subscription_id: 'I-SUB1',
                amount: { currency_code: 'USD', value },
                note: 'Retry after card update',
                evidence_refs: ['I-SUB1'],
                rationale: 'One failed renewal (PAYMENT_DENIED); the customer updated their card.',
                confidence: 0.7,
              },
            },
          ],
        };
      return { content: [{ type: 'text', text: 'Proposed a retry.' }] };
    };

  it('detects, proposes T2, captures the outstanding balance once (72 h request id)', async () => {
    await seedSub(2400);
    const { ctx, runner } = makeCtx(script('24.00'));
    await runner.start('detect_exceptions', []);
    const ex = (await listExceptions(env.handle.db)).find((e) => e.type === 'FAILED_RENEWAL')!;
    expect(ex).toMatchObject({ targetRef: 'subscription:I-SUB1', amountAtRiskCents: 2400 });
    const [p] = await listProposalsForException(env.handle.db, ex.id);
    expect(p).toMatchObject({ status: 'PENDING_APPROVAL', riskTier: 2 });
    await approveProposal(gateDeps(ctx), { proposalId: p!.id, approver: 'judge' });
    expect((await getProposal(env.handle.db, p!.id))?.status).toBe('SUCCEEDED');
    const effect = env.fake.effects.filter((e) => e.op === 'subscriptions.capture');
    expect(effect).toHaveLength(1);
    expect(effect[0]!.requestId).toBeTruthy();
    expect(env.fake.subscriptions.get('I-SUB1')!.billing_info.outstanding_balance.value).toBe(
      '0.00',
    );
  });

  it('a retry above the outstanding balance is rejected by policy (R4) before any call', async () => {
    await seedSub(2400);
    const { runner } = makeCtx(script('30.00'));
    await runner.start('detect_exceptions', []);
    const ex = (await listExceptions(env.handle.db)).find((e) => e.type === 'FAILED_RENEWAL')!;
    const [p] = await listProposalsForException(env.handle.db, ex.id);
    expect(p!.status).toBe('POLICY_REJECTED');
    expect(env.fake.calls['subscriptions.capture']).toBeUndefined();
  });
});
