import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  FileFixtureStore,
  LayeredFixtureStore,
  MemoryFixtureStore,
  ReplayMissError,
  SCRUBBED,
  createReplayFetch,
  llmKey,
  paypalKey,
} from '../src/index.js';

const BASE = 'https://api-m.sandbox.paypal.com';
const SECRET = 'super-secret-client-value-123';
const server = setupServer();
let authState = 'CREATED';
let hits = 0;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  authState = 'CREATED';
  hits = 0;
});
afterAll(() => server.close());

function paypalHandlers() {
  server.use(
    http.post(`${BASE}/v1/oauth2/token`, () =>
      HttpResponse.json({
        access_token: 'LIVE-TOKEN-abcdef123456',
        token_type: 'Bearer',
        expires_in: 100,
      }),
    ),
    http.get(`${BASE}/v2/payments/authorizations/A1`, () => {
      hits++;
      return HttpResponse.json(
        { id: 'A1', status: authState, note: `echo ${SECRET}` },
        { headers: { 'paypal-debug-id': 'dbg-1', 'set-cookie': 'x=1' } },
      );
    }),
    http.post(`${BASE}/v2/payments/authorizations/A1/capture`, async ({ request }) => {
      hits++;
      authState = 'CAPTURED';
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ id: 'CAP1', status: 'COMPLETED', echo: body }, { status: 201 });
    }),
    http.post(
      `${BASE}/v2/payments/authorizations/A1/void`,
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
}

/** A small scripted PayPal conversation. */
async function scenario(f: typeof fetch) {
  const auth = { Authorization: `Bearer LIVE-TOKEN-abcdef123456` };
  const token = await (
    await f(`${BASE}/v1/oauth2/token`, { method: 'POST', body: 'grant_type=client_credentials' })
  ).json();
  const before = await (await f(`${BASE}/v2/payments/authorizations/A1`, { headers: auth })).json();
  const cap = await f(`${BASE}/v2/payments/authorizations/A1/capture`, {
    method: 'POST',
    headers: {
      ...auth,
      'PayPal-Request-Id': crypto.randomUUID(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ final_capture: true, amount: { value: '48.00', currency_code: 'USD' } }),
  });
  const after = await (await f(`${BASE}/v2/payments/authorizations/A1`, { headers: auth })).json();
  const voided = await f(`${BASE}/v2/payments/authorizations/A1/void`, {
    method: 'POST',
    headers: auth,
  });
  return {
    tokenType: (token as { token_type: string }).token_type,
    before: (before as { status: string }).status,
    capStatus: cap.status,
    cap: await cap.json(),
    capDebug: cap.headers.get('content-type'),
    after: (after as { status: string }).status,
    voided: voided.status,
  };
}

describe('record → replay', () => {
  it('replays a recorded run with identical results, with no network', async () => {
    paypalHandlers();
    const store = new MemoryFixtureStore();
    const live = await scenario(
      createReplayFetch({ mode: 'live', kind: 'paypal', store, record: true, secrets: [SECRET] }),
    );
    const liveHits = hits;
    server.resetHandlers(); // network gone: any real call now fails as unhandled

    const replayed = await scenario(createReplayFetch({ mode: 'replay', kind: 'paypal', store }));
    expect(replayed).toEqual({ ...live, tokenType: 'Bearer' });
    expect(live).toMatchObject({
      before: 'CREATED',
      after: 'CAPTURED',
      capStatus: 201,
      voided: 204,
    });
    expect(hits).toBe(liveHits);
  });

  it('keys ignore PayPal-Request-Id, auth headers and JSON key order', async () => {
    paypalHandlers();
    const store = new MemoryFixtureStore();
    const rec = createReplayFetch({ mode: 'live', kind: 'paypal', store, record: true });
    await rec(`${BASE}/v2/payments/authorizations/A1/capture`, {
      method: 'POST',
      headers: { 'PayPal-Request-Id': 'one', Authorization: 'Bearer a' },
      body: JSON.stringify({
        final_capture: true,
        amount: { currency_code: 'USD', value: '48.00' },
      }),
    });
    const replay = createReplayFetch({ mode: 'replay', kind: 'paypal', store });
    const res = await replay(`${BASE}/v2/payments/authorizations/A1/capture`, {
      method: 'POST',
      headers: { 'PayPal-Request-Id': 'two', Authorization: 'Bearer b' },
      body: JSON.stringify({
        amount: { value: '48.00', currency_code: 'USD' },
        final_capture: true,
      }),
    });
    expect(res.status).toBe(201);
    expect(paypalKey('GET', new URL(`${BASE}/x?b=2&a=1`), '')).toBe(
      paypalKey('get', new URL(`${BASE}/x?a=1&b=2`), ''),
    );
  });

  it('a missing fixture fails loudly instead of calling the network', async () => {
    const replay = createReplayFetch({
      mode: 'replay',
      kind: 'paypal',
      store: new MemoryFixtureStore(),
    });
    await expect(replay(`${BASE}/v2/checkout/orders/NOPE`)).rejects.toBeInstanceOf(ReplayMissError);
    await expect(replay(`${BASE}/v2/checkout/orders/NOPE`)).rejects.toThrow(/never falls back/);
  });

  it('answers PayPal OAuth locally in replay mode (zero keys)', async () => {
    const replay = createReplayFetch({
      mode: 'replay',
      kind: 'paypal',
      store: new MemoryFixtureStore(),
    });
    const t = (await (await replay(`${BASE}/v1/oauth2/token`, { method: 'POST' })).json()) as {
      access_token: string;
    };
    expect(t.access_token).toBe('replay-token');
  });
});

describe('scrubbing', () => {
  it('a recorded fixture contains no secrets', async () => {
    paypalHandlers();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vigil-replay-'));
    try {
      const store = new FileFixtureStore(dir);
      const f = createReplayFetch({
        mode: 'live',
        kind: 'paypal',
        store,
        record: true,
        secrets: [SECRET],
      });
      await scenario(f);
      await f(`${BASE}/v2/payments/authorizations/A1/capture`, {
        method: 'POST',
        body: JSON.stringify({
          payment_source: { card: { number: '4111111111111111', security_code: '123' } },
          note: SECRET,
        }),
      });
      const files = await readdir(path.join(dir, 'paypal'));
      expect(files.length).toBeGreaterThanOrEqual(4);
      const all = (
        await Promise.all(files.map((f) => readFile(path.join(dir, 'paypal', f), 'utf8')))
      ).join('\n');
      for (const leaked of [
        SECRET,
        'LIVE-TOKEN-abcdef123456',
        '4111111111111111',
        'set-cookie',
        'x=1',
      ]) {
        expect(all).not.toContain(leaked);
      }
      expect(all).toContain(SCRUBBED);
      expect(all).toContain('paypal-debug-id');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('scrubs secrets inside streamed (SSE) LLM responses', async () => {
    server.use(
      http.post(
        'https://api.anthropic.com/v1/messages',
        () =>
          new HttpResponse(
            `event: message_start\ndata: {"type":"message_start","api_key":"k"}\n\ndata: {"text":"${SECRET}"}\n\n`,
            {
              headers: { 'content-type': 'text/event-stream' },
            },
          ),
      ),
    );
    const store = new MemoryFixtureStore();
    const f = createReplayFetch({
      mode: 'live',
      kind: 'llm',
      store,
      record: true,
      secrets: [SECRET],
    });
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-should-not-be-stored' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(await res.text()).toContain(SECRET); // the live caller still sees the real body
    const saved = JSON.stringify([...store.recordings.values()]);
    expect(saved).not.toContain(SECRET);
    expect(saved).not.toContain('sk-ant-should-not-be-stored');
    expect(saved).toContain('message_start');
  });
});

describe('keys and stores', () => {
  it('llm keys depend on model, system, messages and tools only', () => {
    const a = llmKey(
      JSON.stringify({ model: 'm', system: 's', messages: [], tools: [], max_tokens: 10 }),
    );
    const b = llmKey(
      JSON.stringify({
        tools: [],
        messages: [],
        system: 's',
        model: 'm',
        max_tokens: 99,
        temperature: 1,
      }),
    );
    const c = llmKey(JSON.stringify({ model: 'other', system: 's', messages: [], tools: [] }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('layered store reads through and writes to the first store', async () => {
    const top = new MemoryFixtureStore();
    const bottom = new MemoryFixtureStore();
    const rec = {
      key: 'a'.repeat(64),
      kind: 'llm' as const,
      request: { method: 'POST', url: '/', body: null },
      response: { status: 200, headers: {}, body: '{}' },
      recordedAt: '',
    };
    await bottom.put(rec);
    const layered = new LayeredFixtureStore([top, bottom]);
    expect(await layered.get('llm', rec.key)).toEqual(rec);
    await layered.put({ ...rec, key: 'b'.repeat(64) });
    expect(top.recordings.size).toBe(1);
  });

  it('file store rejects path-like keys', async () => {
    await expect(new FileFixtureStore(os.tmpdir()).get('llm', '../../etc/passwd')).rejects.toThrow(
      /Invalid fixture key/,
    );
  });
});
