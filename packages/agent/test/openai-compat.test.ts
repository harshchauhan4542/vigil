import { createTestDb, listProposalsForException, upsertException, type DbHandle } from '@vigil/db';
import { MemoryCache, createPayPalClient, type PayPalHttp } from '@vigil/paypal';
import { MemoryFixtureStore } from '@vigil/replay';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLlmClient } from '../src/client.js';
import { triageException } from '../src/loop.js';
import {
  LlmApiError,
  createOpenAICompatClient,
  fromOpenAIResponse,
  toOpenAIRequest,
  type OaiMessage,
  type OaiRequest,
} from '../src/openai-compat.js';

const PP = 'https://api-m.sandbox.paypal.com';
const LLM = 'https://llm.example.test/openai/v1';
const KEY = 'gsk_fake_test_key_1234567890abcdef';
const MODEL = 'openai/gpt-oss-120b';
const server = setupServer();
let handle: DbHandle;
let paypal: PayPalHttp;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  handle = await createTestDb();
  server.use(
    http.post(`${PP}/v1/oauth2/token`, () =>
      HttpResponse.json({ access_token: 'T', token_type: 'Bearer', expires_in: 32400 }),
    ),
    http.get(`${PP}/v2/payments/authorizations/AUTH-OLD`, () =>
      HttpResponse.json({
        id: 'AUTH-OLD',
        status: 'CREATED',
        amount: { currency_code: 'USD', value: '48.00' },
        create_time: '2026-11-03T00:00:00Z',
        expiration_time: '2026-12-02T00:00:00Z',
        supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
      }),
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

const call = (id: string, name: string, args: unknown) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
const reply = (message: { content?: string | null; tool_calls?: ToolCall[] }, finish = 'stop') => ({
  id: 'chatcmpl-1',
  model: MODEL,
  choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', ...message } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});

function client(extra: Partial<Parameters<typeof createOpenAICompatClient>[0]> = {}) {
  return createOpenAICompatClient({
    mode: 'live',
    baseURL: LLM,
    apiKey: KEY,
    store: new MemoryFixtureStore(),
    sleep: async () => {},
    ...extra,
  });
}

describe('request translation', () => {
  it('maps system, tool calls, tool results, tool choice and drops Claude-only knobs', () => {
    const req = toOpenAIRequest(
      {
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: 'You are Vigil.', cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        tool_choice: { type: 'any' },
        tools: [
          {
            name: 'get_exception',
            description: 'Read one exception',
            input_schema: { type: 'object', properties: { exception_id: { type: 'string' } } },
            strict: true,
          },
        ],
        messages: [
          { role: 'user', content: 'Triage it.' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'secret', signature: 'sig' },
              { type: 'text', text: 'Reading.' },
              { type: 'tool_use', id: 't1', name: 'get_exception', input: { exception_id: 'X' } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' },
              { type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true },
              { type: 'text', text: 'Continue.' },
            ],
          },
        ],
      },
      8192,
    );
    expect(req.max_tokens).toBe(8192);
    expect(req.tool_choice).toBe('required');
    expect(req.tools?.[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_exception',
        description: 'Read one exception',
        parameters: { type: 'object', properties: { exception_id: { type: 'string' } } },
      },
    });
    expect(req.messages).toEqual<OaiMessage[]>([
      { role: 'system', content: 'You are Vigil.' },
      { role: 'user', content: 'Triage it.' },
      {
        role: 'assistant',
        content: 'Reading.',
        tool_calls: [call('t1', 'get_exception', { exception_id: 'X' })],
      },
      { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
      { role: 'tool', tool_call_id: 't2', content: 'ERROR: boom' },
      { role: 'user', content: 'Continue.' },
    ]);
    expect(JSON.stringify(req)).not.toMatch(/thinking|cache_control|strict|secret/);
  });

  it('turns a JSON-schema output format into json_object plus the schema in the system prompt', () => {
    const req = toOpenAIRequest({
      model: MODEL,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Chart it' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    } as Parameters<typeof toOpenAIRequest>[0]);
    expect(req.response_format).toEqual({ type: 'json_object' });
    expect(req.messages[0]).toMatchObject({ role: 'system' });
    expect((req.messages[0] as { content: string }).content).toContain('{"type":"object"}');
  });
});

describe('response translation', () => {
  it('maps tool calls to tool_use blocks and finish reasons to stop reasons', () => {
    const m = fromOpenAIResponse(
      reply(
        { content: 'Let me look.', tool_calls: [call('c1', 'get_exception', { a: 1 })] },
        'tool_calls',
      ),
      MODEL,
    );
    expect(m.stop_reason).toBe('tool_use');
    expect(m.content).toEqual([
      { type: 'text', text: 'Let me look.', citations: null },
      { type: 'tool_use', id: 'c1', name: 'get_exception', input: { a: 1 } },
    ]);
    expect(m.usage).toMatchObject({ input_tokens: 100, output_tokens: 20 });
    expect(fromOpenAIResponse(reply({ content: 'x' }, 'length'), MODEL).stop_reason).toBe(
      'max_tokens',
    );
    expect(fromOpenAIResponse(reply({ content: 'x' }), MODEL).stop_reason).toBe('end_turn');
  });

  it('passes malformed tool arguments through so the tool schema rejects them', () => {
    const m = fromOpenAIResponse(
      reply({
        tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '{bad' } }],
      }),
      MODEL,
    );
    expect(m.content[0]).toMatchObject({
      type: 'tool_use',
      input: { invalid_json_arguments: '{bad' },
    });
  });
});

describe('OpenAI-compatible client', () => {
  it('runs a full triage that ends in a DRAFT proposal, with bearer auth and no Claude knobs', async () => {
    const { exception: ex } = await upsertException(
      handle.db,
      {
        type: 'AUTH_HONOR_EXPIRING',
        targetRef: 'authorization:AUTH-OLD',
        amountAtRiskCents: 4800,
        currency: 'USD',
        deadlineAt: new Date('2026-11-06T00:00:00Z'),
        detectorVersion: 'e3.v1',
        evidence: { authorization_id: 'AUTH-OLD', order_id: 'ORDER-1', phase: 'honor_ending' },
      },
      { type: 'detector', id: 't' },
    );
    const seen: { auth: string | null; body: OaiRequest }[] = [];
    server.use(
      http.post(`${LLM}/chat/completions`, async ({ request }) => {
        const body = (await request.json()) as OaiRequest;
        seen.push({ auth: request.headers.get('authorization'), body });
        const done = body.messages.filter((m) => m.role === 'tool').length;
        if (done === 0)
          return HttpResponse.json(
            reply(
              { tool_calls: [call('a', 'get_exception', { exception_id: ex.id })] },
              'tool_calls',
            ),
          );
        if (done === 1)
          return HttpResponse.json(
            reply(
              { tool_calls: [call('b', 'get_authorization', { authorization_id: 'AUTH-OLD' })] },
              'tool_calls',
            ),
          );
        if (done === 2)
          return HttpResponse.json(
            reply(
              {
                tool_calls: [
                  call('c', 'propose_capture_authorization', {
                    authorization_id: 'AUTH-OLD',
                    amount: { currency_code: 'USD', value: '48.00' },
                    final_capture: true,
                    evidence_refs: ['AUTH-OLD', ex.id],
                    rationale: 'Honor period ends within 12h; capture the full $48.00 now.',
                    confidence: 0.8,
                  }),
                ],
              },
              'tool_calls',
            ),
          );
        return HttpResponse.json(reply({ content: 'Proposed a full capture of $48.00.' }));
      }),
    );

    const result = await triageException(
      {
        client: client(),
        db: handle.db,
        http: paypal,
        model: MODEL,
        mode: 'live',
        effort: 'high',
        policyLimits: { per_action_cap_usd: 500 },
      },
      ex.id,
    );

    expect(result).toMatchObject({ stopReason: 'end_turn', turns: 4 });
    expect(result.finalText).toBe('Proposed a full capture of $48.00.');
    const [p] = await listProposalsForException(handle.db, ex.id);
    expect(p).toMatchObject({
      status: 'DRAFT',
      actionType: 'capture_authorization',
      amountCents: 4800,
    });
    expect(seen).toHaveLength(4);
    expect(seen[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.body.model).toBe(MODEL);
    expect(seen[0]!.body.tools?.length).toBeGreaterThan(3);
    expect(JSON.stringify(seen[0]!.body)).not.toMatch(/"thinking"|output_config|cache_control/);
  });

  it('retries rate limits and malformed tool calls, then succeeds', async () => {
    let n = 0;
    server.use(
      http.post(`${LLM}/chat/completions`, () => {
        n++;
        if (n === 1)
          return HttpResponse.json(
            { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } },
            { status: 429, headers: { 'retry-after': '1' } },
          );
        if (n === 2)
          return HttpResponse.json(
            { error: { message: 'Failed to call a function', code: 'tool_use_failed' } },
            { status: 400 },
          );
        return HttpResponse.json(reply({ content: 'ok' }));
      }),
    );
    const waits: number[] = [];
    const c = client({ sleep: async (ms) => void waits.push(ms) });
    const m = await c.messages.create({
      model: MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(n).toBe(3);
    expect(waits[0]).toBe(1000);
    expect(m.content).toEqual([{ type: 'text', text: 'ok', citations: null }]);
  });

  it('sends one request at a time, so parallel triages share a small rate limit', async () => {
    let inFlight = 0;
    let peak = 0;
    server.use(
      http.post(`${LLM}/chat/completions`, async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return HttpResponse.json(reply({ content: 'ok' }));
      }),
    );
    const c = client();
    const ask = () =>
      c.messages.create({
        model: MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      });
    const all = await Promise.all([ask(), ask(), ask()]);
    expect(all).toHaveLength(3);
    expect(peak).toBe(1);
  });

  it('keeps waiting through repeated rate limits', async () => {
    let n = 0;
    server.use(
      http.post(`${LLM}/chat/completions`, () =>
        ++n < 6
          ? HttpResponse.json(
              { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } },
              { status: 429, headers: { 'retry-after': '90' } },
            )
          : HttpResponse.json(reply({ content: 'ok' })),
      ),
    );
    const waits: number[] = [];
    const m = await client({ sleep: async (ms) => void waits.push(ms) }).messages.create({
      model: MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(n).toBe(6);
    expect(waits).toEqual([60_000, 60_000, 60_000, 60_000, 60_000]);
    expect(m.content).toEqual([{ type: 'text', text: 'ok', citations: null }]);
  });

  it('fails with a clear error that never contains the key', async () => {
    server.use(
      http.post(`${LLM}/chat/completions`, () =>
        HttpResponse.json(
          { error: { message: 'Invalid API Key', code: 'invalid_api_key' } },
          { status: 401 },
        ),
      ),
    );
    const err = await client()
      .messages.create({
        model: MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmApiError);
    expect((err as LlmApiError).status).toBe(401);
    expect((err as Error).message).toBe('LLM API error 401: Invalid API Key');
    expect((err as Error).message).not.toContain(KEY);
  });

  it('streams the whole text as one event and records a scrubbed fixture', async () => {
    server.use(
      http.post(`${LLM}/chat/completions`, () => HttpResponse.json(reply({ content: 'Hello' }))),
    );
    const store = new MemoryFixtureStore();
    const s = client({ store, record: true }).messages.stream({
      model: MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const deltas: string[] = [];
    s.on('text', (d) => deltas.push(d));
    await s.finalMessage();
    expect(deltas).toEqual(['Hello']);
    expect(store.recordings.size).toBe(1);
    expect(JSON.stringify([...store.recordings.values()])).not.toContain(KEY);
  });
});

describe('createLlmClient', () => {
  const base = { LLM_MAX_OUTPUT_TOKENS: 8192 } as const;
  const store = new MemoryFixtureStore();
  it('returns null in Live when the chosen provider has no key', () => {
    expect(
      createLlmClient(
        { ...base, LLM_PROVIDER: 'openai', LLM_BASE_URL: LLM },
        { mode: 'live', store },
      ),
    ).toBeNull();
    expect(
      createLlmClient({ ...base, LLM_PROVIDER: 'anthropic' }, { mode: 'live', store }),
    ).toBeNull();
  });
  it('builds a client for each configured provider, and always one in Replay', () => {
    expect(
      createLlmClient(
        { ...base, LLM_PROVIDER: 'openai', LLM_BASE_URL: LLM, LLM_API_KEY: KEY },
        { mode: 'live', store },
      ),
    ).not.toBeNull();
    expect(
      createLlmClient(
        { ...base, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' },
        { mode: 'live', store },
      ),
    ).not.toBeNull();
    expect(
      createLlmClient({ ...base, LLM_PROVIDER: 'openai' }, { mode: 'replay', store }),
    ).not.toBeNull();
  });
});
