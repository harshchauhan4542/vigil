import { loadWebEnv } from '@vigil/config';
import { paramsHash } from '@vigil/core';
import {
  createTestDb,
  getProposal,
  insertDraftProposal,
  listExecutions,
  upsertException,
  type DbHandle,
} from '@vigil/db';
import { evaluateDraft } from '@vigil/gate';
import { MemoryCache, createPayPalClient } from '@vigil/paypal';
import { POLICY_V1 } from '@vigil/policy';
import { MemoryFixtureStore } from '@vigil/replay';
import { BASE, FakePayPal } from '@vigil/workflows/testing';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as approve } from '../app/api/proposals/[id]/approve/route';
import { GET as getProposalRoute } from '../app/api/proposals/[id]/route';
import { POST as reject } from '../app/api/proposals/[id]/reject/route';
import { GET as exceptionsRoute } from '../app/api/exceptions/route';
import { GET as health } from '../app/api/health/route';
import { POST as setMode } from '../app/api/demo/mode/route';
import { resetGuardsForTests } from '../lib/guards';
import { createInlineRunner } from '../lib/inline-runner';
import { assemble, setServerForTests, type Core, type Server } from '../lib/server';

const msw = setupServer();
let fake: FakePayPal;
let handle: DbHandle;
let server: Server;
const SECRET = 's'.repeat(40);

beforeAll(() => msw.listen({ onUnhandledFrame: 'error' }));
afterAll(() => msw.close());
beforeEach(async () => {
  resetGuardsForTests();
  fake = new FakePayPal();
  msw.use(...fake.handlers());
  handle = await createTestDb();
  const { http } = await createPayPalClient({
    clientId: 'c',
    secret: 's',
    baseUrl: BASE,
    cache: new MemoryCache(),
    sleep: async () => {},
  });
  const env = loadWebEnv({
    APPROVAL_HMAC_SECRET: SECRET,
    SESSION_SECRET: SECRET,
    VIGIL_MODE: 'replay',
  });
  const core: Core = {
    db: handle.db,
    http,
    claude: null,
    store: new MemoryFixtureStore(),
    policy: POLICY_V1,
    now: () => new Date(),
  };
  server = assemble(env, 'live', core, createInlineRunner(core, env, 'live', true));
  setServerForTests(server);
});
afterEach(async () => {
  setServerForTests(null);
  msw.resetHandlers();
  await handle.close();
});

async function pendingCapture() {
  fake.addAuthorization('AUTH1', 4800, new Date(Date.now() - 61 * 3_600_000).toISOString());
  const { exception } = await upsertException(
    handle.db,
    {
      type: 'AUTH_HONOR_EXPIRING',
      targetRef: 'authorization:AUTH1',
      amountAtRiskCents: 4800,
      currency: 'USD',
      detectorVersion: 'e3.v1',
      evidence: { authorization_id: 'AUTH1' },
    },
    { type: 'detector', id: 't' },
  );
  const params = {
    authorization_id: 'AUTH1',
    amount: { currency_code: 'USD', value: '48.00' },
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
  await evaluateDraft(server.gate, p.id);
  return p;
}

const post = (url: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('approve route', () => {
  it('approves, executes once, sets a signed session cookie, and hides the token', async () => {
    const p = await pendingCapture();
    const res = await approve(post(`/api/proposals/${p.id}/approve`), ctx(p.id));
    expect(res.status).toBe(202);
    expect(res.headers.get('set-cookie')).toMatch(
      /^vigil_session=judge-[^.]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly/,
    );
    expect((await getProposal(handle.db, p.id))?.status).toBe('SUCCEEDED');
    expect(fake.effects).toHaveLength(1);

    const detail = await (
      await getProposalRoute(new Request(`http://localhost/api/proposals/${p.id}`), ctx(p.id))
    ).json();
    expect(detail.approval).toMatchObject({ decision: 'APPROVED' });
    expect(JSON.stringify(detail)).not.toMatch(/token_hash|tokenHash/);
  });

  it('a double POST (simultaneous clicks) gives one execution', async () => {
    const p = await pendingCapture();
    const [a, b] = await Promise.all([
      approve(post(`/api/proposals/${p.id}/approve`), ctx(p.id)),
      approve(post(`/api/proposals/${p.id}/approve`), ctx(p.id)),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect(await listExecutions(handle.db, p.id)).toHaveLength(1);
    expect(fake.effects).toHaveLength(1);
  });

  it('approval with stale state is refused (409) and nothing executes', async () => {
    const p = await pendingCapture();
    fake.authorizations.get('AUTH1')!.status = 'VOIDED';
    const res = await approve(post(`/api/proposals/${p.id}/approve`), ctx(p.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('policy_failed');
    expect(body.policy.rules.find((r: { id: string }) => r.id === 'R3').status).toBe('fail');
    expect(fake.effects).toHaveLength(0);
  });

  it('rate limit returns 429 with retry-after', async () => {
    const statuses = [];
    for (let i = 0; i < 22; i++) {
      statuses.push(
        (
          await reject(
            post(
              '/api/proposals/00000000-0000-4000-8000-000000000000/reject',
              {},
              { 'x-forwarded-for': '9.9.9.9' },
            ),
            ctx('00000000-0000-4000-8000-000000000000'),
          )
        ).status,
      );
    }
    expect(statuses.slice(0, 20).every((s) => s === 409)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  it('rejects malformed ids without touching the database', async () => {
    expect((await approve(post('/api/proposals/../x/approve'), ctx('../x'))).status).toBe(404);
  });
});

describe('read routes', () => {
  it('health and the exception queue', async () => {
    await pendingCapture();
    expect(await (await health(new Request('http://localhost/api/health'))).json()).toMatchObject({
      ok: true,
      mode: 'live',
    });
    const q = await (await exceptionsRoute(new Request('http://localhost/api/exceptions'))).json();
    expect(q.exceptions).toHaveLength(1);
    expect(q.exceptions[0].latestProposal).toMatchObject({
      status: 'PENDING_APPROVAL',
      riskTier: 2,
    });
  });

  it('mode switch sets a cookie and validates input', async () => {
    const ok = await setMode(post('/api/demo/mode', { mode: 'replay' }));
    expect(ok.headers.get('set-cookie')).toContain('vigil_mode=replay');
    expect((await setMode(post('/api/demo/mode', { mode: 'prod' }))).status).toBe(400);
  });
});

describe('step 17 routes', () => {
  it('stats, trail, and the simulate-failure toggle (Payments v2 only)', async () => {
    const { GET: stats } = await import('../app/api/stats/route');
    const { GET: trail } = await import('../app/api/exceptions/[id]/trail/route');
    const p = await pendingCapture();
    const s = await (await stats(new Request('http://localhost/api/stats'))).json();
    expect(s.atRisk).toEqual([{ currency: 'USD', cents: 4800, count: 1 }]);

    fake.fail('authorizations.capture', 422, 1, { issue: 'AUTHORIZATION_EXPIRED' });
    const res = await approve(
      post(`/api/proposals/${p.id}/approve`, { mock_code: 'AUTHORIZATION_EXPIRED' }),
      ctx(p.id),
    );
    expect(res.status).toBe(202);
    const [exec] = await listExecutions(handle.db, p.id);
    expect(exec).toMatchObject({ mockCode: 'AUTHORIZATION_EXPIRED', httpStatus: 422 });

    const t = await (await trail(new Request('http://localhost/x'), ctx(p.exceptionId))).json();
    const actions = t.trail.map((r: { action: string }) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['exception.detected', 'proposal.drafted', 'approval.approved']),
    );
  });

  it('refuses a mock code on an action PayPal cannot mock', async () => {
    const p = await pendingCapture();
    await handle.db.execute(
      (await import('drizzle-orm'))
        .sql`update proposals set action_type = 'suspend_subscription' where id = ${p.id}`,
    );
    const res = await approve(
      post(`/api/proposals/${p.id}/approve`, { mock_code: 'INTERNAL_SERVER_ERROR' }),
      ctx(p.id),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('mock_not_supported');
  });
});

describe('/api/ai (Claude behind Studio built-in agents)', () => {
  it('translates an AgLlmRequest, calls Claude with strict-free tools, returns an AgLlmResponse', async () => {
    const { FakeClaude } = await import('@vigil/agent/testing');
    const { createClaudeClient } = await import('@vigil/agent');
    const { POST: ai } = await import('../app/api/ai/route');
    const claude = new FakeClaude(() => ({
      content: [{ type: 'tool_use', name: 'studio_addWidget', input: { type: 'bar' } }],
    }));
    msw.use(claude.handler());
    setServerForTests({
      ...server,
      claude: createClaudeClient({
        mode: 'live',
        apiKey: 'fake-anthropic-test',
        store: new MemoryFixtureStore(),
      }),
    });
    const res = await ai(
      post('/api/ai', {
        instructions: 'Build dashboards',
        responseFormat: { type: 'text' },
        toolChoice: 'required',
        tools: [
          {
            name: 'studio_addWidget',
            description: 'Add',
            parameters: { type: 'object', properties: {} },
          },
        ],
        input: [
          {
            id: 'u',
            kind: 'input',
            type: 'message',
            role: 'user',
            status: 'completed',
            content: [{ type: 'text', text: 'Chart it' }],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output[0]).toMatchObject({
      type: 'function_call',
      name: 'studio_addWidget',
      arguments: '{"type":"bar"}',
    });
    expect(claude.requests[0]).toMatchObject({
      model: 'claude-sonnet-5',
      tool_choice: { type: 'any' },
      thinking: { type: 'disabled' },
      system: 'Build dashboards',
    });
  });
});
