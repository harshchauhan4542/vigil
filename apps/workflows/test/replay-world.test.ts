// The committed Replay world (fixtures/demo + fixtures/recordings) must replay end to end with
// zero keys and NO network. If this fails, regenerate with `pnpm --filter @vigil/workflows demo:build`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeClient, triageException } from '@vigil/agent';
import {
  createTestDb,
  getException,
  getProposal,
  listExceptions,
  listProposalsByStatus,
  verifyChain,
  type DbHandle,
} from '@vigil/db';
import { approveProposal } from '@vigil/gate';
import { MemoryCache, createPayPalClient } from '@vigil/paypal';
import { POLICY_V1 } from '@vigil/policy';
import { FileFixtureStore, createReplayFetch } from '@vigil/replay';
import { InlineTaskRunner } from '@vigil/tasks';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gateDeps, type WorkflowContext } from '../src/context.js';
import { prepareReplayWorld, readDemoManifest } from '../src/demo/world.js';
import { buildHandlers } from '../src/tasks/index.js';
import { BASE } from '../src/testing/fake-paypal.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const network = setupServer(); // no handlers: any real request fails the test
let handle: DbHandle;
let ctx: WorkflowContext;

beforeAll(async () => {
  network.listen({ onUnhandledFrame: 'error' });
  const manifest = readDemoManifest(repoRoot)!;
  const now = new Date(manifest.recordedAt);
  handle = await createTestDb();
  const store = new FileFixtureStore(path.join(repoRoot, 'fixtures', 'recordings'));
  const { http } = await createPayPalClient({
    clientId: 'replay',
    secret: 'replay',
    baseUrl: BASE,
    cache: new MemoryCache(),
    sleep: async () => {},
    fetch: createReplayFetch({ mode: 'replay', kind: 'paypal', store }),
  });
  const client = createClaudeClient({ mode: 'replay', store });
  const runner = new InlineTaskRunner();
  ctx = {
    db: handle.db,
    http,
    runner,
    approvalSecret: 'replay-world-test-secret-0123456789abcdef',
    executionEnabled: true,
    policy: POLICY_V1,
    triage: (id) =>
      triageException(
        {
          client,
          db: handle.db,
          http,
          model: 'claude-opus-5-5',
          mode: 'replay',
          effort: 'high',
          policyLimits: { per_action_cap_usd: 500, daily_cap_usd: 2000 },
        },
        id,
      ),
    maxAttempts: 3,
    now: () => now,
    sleep: async () => {},
    log: () => {},
  };
  runner.register(buildHandlers(async () => ctx));
  expect(await prepareReplayWorld(handle.db, runner, repoRoot)).toEqual({ loaded: true });
});

afterAll(async () => {
  network.close();
  await handle?.close();
});

const pendingFor = async (target: string) =>
  (await listProposalsByStatus(handle.db, ['PENDING_APPROVAL'])).find(
    (p) => p.targetRef === target,
  )!;

describe('Replay world (zero keys, no network)', () => {
  it('is labelled synthetic until real sandbox recordings replace it', () => {
    expect(readDemoManifest(repoRoot)).toMatchObject({ synthetic: true });
  });

  it('detects all five exception kinds and the agent proposes for each', async () => {
    const types = (await listExceptions(handle.db)).map((e) => e.type).sort();
    expect(types).toEqual([
      'AUTH_HONOR_EXPIRING',
      'AUTH_HONOR_EXPIRING',
      'AUTH_HONOR_EXPIRING',
      'FAILED_RENEWAL',
      'UNMATCHED_TXN',
      'UNMATCHED_TXN',
      'UNTRACKED_CAPTURE',
    ]);
    expect(await listProposalsByStatus(handle.db, ['PENDING_APPROVAL'])).toHaveLength(6);
  });

  it('the prompt-injection refund is POLICY_REJECTED and its exception escalated', async () => {
    const [p] = await listProposalsByStatus(handle.db, ['POLICY_REJECTED']);
    expect(p).toMatchObject({ actionType: 'refund', amountCents: 90000 });
    expect((await getException(handle.db, p!.exceptionId))?.status).toBe('ESCALATED');
  });

  it('approve → capture SUCCEEDED; mocked AUTHORIZATION_EXPIRED → FAILED_FINAL; T3 needs the typed amount', async () => {
    const a48 = await pendingFor('authorization:AUTH-48');
    await approveProposal(gateDeps(ctx), { proposalId: a48.id, approver: 'judge' });
    expect((await getProposal(handle.db, a48.id))?.status).toBe('SUCCEEDED');

    const a129 = await pendingFor('authorization:AUTH-129');
    await approveProposal(gateDeps(ctx), {
      proposalId: a129.id,
      approver: 'judge',
      mockCode: 'AUTHORIZATION_EXPIRED',
    });
    expect((await getProposal(handle.db, a129.id))?.status).toBe('FAILED_FINAL');

    const a612 = await pendingFor('authorization:AUTH-612');
    expect(
      await approveProposal(gateDeps(ctx), { proposalId: a612.id, approver: 'judge' }),
    ).toMatchObject({ code: 'typed_amount_required' });
    await approveProposal(gateDeps(ctx), {
      proposalId: a612.id,
      approver: 'judge',
      typedAmount: '612.00',
    });
    expect((await getProposal(handle.db, a612.id))?.status).toBe('SUCCEEDED');
  });

  it('E2 tracking, E1 retry and the E4 journal entry execute; settle_check resolves', async () => {
    for (const t of ['capture:CAP-89', 'subscription:I-BEANS']) {
      const p = await pendingFor(t);
      await approveProposal(gateDeps(ctx), { proposalId: p.id, approver: 'judge' });
      expect((await getProposal(handle.db, p.id))?.status).toBe('SUCCEEDED');
    }
    const journal = (await listProposalsByStatus(handle.db, ['PENDING_APPROVAL'])).find(
      (p) => p.actionType === 'journal_entry',
    )!;
    await approveProposal(gateDeps(ctx), { proposalId: journal.id, approver: 'judge' });
    expect((await getProposal(handle.db, journal.id))?.status).toBe('SETTLED');
    await ctx.runner.start('settle_check', []);
    expect(await listProposalsByStatus(handle.db, ['SUCCEEDED'])).toHaveLength(0);
    expect(await verifyChain(handle.db)).toMatchObject({ ok: true });
  });
});
