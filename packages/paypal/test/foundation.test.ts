import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MemoryCache } from '../src/cache.js';
import {
  ISSUE_KINDS,
  PayPalApiError,
  PayPalAuthError,
  PayPalNetworkError,
  isRetryableStatus,
} from '../src/errors.js';
import {
  OPERATIONS,
  canRetryWithSameId,
  paypalRequestId,
  retentionUntil,
  supportsRequestId,
} from '../src/idempotency.js';
import { REDACTED, redactBody, redactHeaders } from '../src/logger.js';
import { REFRESH_MARGIN_MS } from '../src/token.js';
import { BASE, makeClient, server, tokenHandler } from './helpers.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('token', () => {
  it('caches the token and refreshes 5 minutes before expiry', async () => {
    let now = 1_000_000;
    const calls = { n: 0 };
    server.use(tokenHandler({ expiresIn: 3600, calls }));
    const { tokens } = await makeClient({ now: () => now });

    const t1 = await tokens.getToken();
    await tokens.getToken();
    expect(calls.n).toBe(1);

    now += 3600_000 - REFRESH_MARGIN_MS - 1_000; // still inside the safe window
    expect((await tokens.getToken()).accessToken).toBe(t1.accessToken);
    expect(calls.n).toBe(1);

    now += 2_000; // inside the 5-minute margin → refresh
    const t2 = await tokens.getToken();
    expect(calls.n).toBe(2);
    expect(t2.accessToken).not.toBe(t1.accessToken);
  });

  it('single-flights concurrent refreshes', async () => {
    const calls = { n: 0 };
    server.use(tokenHandler({ calls }));
    const { tokens } = await makeClient();
    const results = await Promise.all(Array.from({ length: 10 }, () => tokens.getToken()));
    expect(calls.n).toBe(1);
    expect(new Set(results.map((t) => t.accessToken)).size).toBe(1);
  });

  it('shares the token between two processes using the same cache', async () => {
    const calls = { n: 0 };
    server.use(tokenHandler({ calls }));
    const cache = new MemoryCache();
    const a = await makeClient({ cache });
    const b = await makeClient({ cache });
    await a.tokens.getToken();
    await b.tokens.getToken();
    expect(calls.n).toBe(1);
  });

  it('maps OAuth errors to PayPalAuthError', async () => {
    server.use(
      http.post(`${BASE}/v1/oauth2/token`, () =>
        HttpResponse.json(
          { error: 'invalid_client', error_description: 'Client Authentication failed' },
          { status: 401 },
        ),
      ),
    );
    const { tokens } = await makeClient();
    const err = await tokens.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalAuthError);
    expect((err as PayPalAuthError).error).toBe('invalid_client');
  });
});

describe('http', () => {
  it('sends auth, JSON, Prefer and PayPal-Request-Id headers', async () => {
    server.use(tokenHandler({ token: 'TOKEN-1' }));
    let seen: Headers | undefined;
    server.use(
      http.post(`${BASE}/v2/payments/authorizations/AUTH1/capture`, ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({ id: 'CAP1', status: 'COMPLETED' }, { status: 201 });
      }),
    );
    const { http: client } = await makeClient();
    const res = await client.request<{ id: string }>({
      method: 'POST',
      path: '/v2/payments/authorizations/AUTH1/capture',
      operation: 'authorizations.capture',
      body: { final_capture: true },
      requestId: 'req-123',
    });
    expect(res).toMatchObject({ status: 201, data: { id: 'CAP1' }, attempts: 1 });
    expect(seen?.get('authorization')).toBe('Bearer TOKEN-1');
    expect(seen?.get('content-type')).toBe('application/json');
    expect(seen?.get('prefer')).toBe('return=representation');
    expect(seen?.get('paypal-request-id')).toBe('req-123');
    expect(seen?.get('paypal-mock-response')).toBeNull();
  });

  it('refreshes the token and retries once on 401', async () => {
    const calls = { n: 0 };
    server.use(tokenHandler({ calls }));
    const auths: string[] = [];
    server.use(
      http.get(`${BASE}/v2/checkout/orders/O1`, ({ request }) => {
        auths.push(request.headers.get('authorization')!);
        return auths.length === 1
          ? HttpResponse.json({ name: 'AUTHENTICATION_FAILURE' }, { status: 401 })
          : HttpResponse.json({ id: 'O1' });
      }),
    );
    const { http: client } = await makeClient();
    const res = await client.get<{ id: string }>('/v2/checkout/orders/O1', 'orders.get');
    expect(res.data.id).toBe('O1');
    expect(calls.n).toBe(2);
    expect(auths[0]).not.toBe(auths[1]);
  });

  it('does not loop on a second 401', async () => {
    server.use(tokenHandler());
    let hits = 0;
    server.use(
      http.get(`${BASE}/v2/checkout/orders/O1`, () => {
        hits++;
        return HttpResponse.json({ name: 'AUTHENTICATION_FAILURE' }, { status: 401 });
      }),
    );
    const { http: client } = await makeClient();
    const err = await client
      .request({ method: 'GET', path: '/v2/checkout/orders/O1', operation: 'orders.get' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).kind).toBe('unauthorized');
    expect(hits).toBe(2);
  });

  it('retries a 503 with the same PayPal-Request-Id', async () => {
    server.use(tokenHandler());
    const ids: (string | null)[] = [];
    server.use(
      http.post(`${BASE}/v2/payments/captures/CAP1/refund`, ({ request }) => {
        ids.push(request.headers.get('paypal-request-id'));
        return ids.length === 1
          ? HttpResponse.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 503 })
          : HttpResponse.json({ id: 'REF1', status: 'COMPLETED' }, { status: 201 });
      }),
    );
    const { http: client } = await makeClient();
    const requestId = paypalRequestId('proposal-1', 'captures.refund');
    const res = await client.request<{ id: string }>({
      method: 'POST',
      path: '/v2/payments/captures/CAP1/refund',
      operation: 'captures.refund',
      body: {},
      requestId,
      retries: 2,
    });
    expect(res.attempts).toBe(2);
    expect(ids).toEqual([requestId, requestId]);
  });

  it('does not retry a final 422', async () => {
    server.use(tokenHandler());
    let hits = 0;
    server.use(
      http.post(`${BASE}/v2/payments/authorizations/AUTH1/capture`, () => {
        hits++;
        return HttpResponse.json(
          {
            name: 'UNPROCESSABLE_ENTITY',
            message: 'The requested action could not be performed.',
            debug_id: 'dbg-42',
            details: [
              { issue: 'AUTHORIZATION_EXPIRED', description: 'Authorization has expired.' },
            ],
          },
          { status: 422 },
        );
      }),
    );
    const { http: client } = await makeClient();
    const err = (await client
      .request({
        method: 'POST',
        path: '/v2/payments/authorizations/AUTH1/capture',
        operation: 'authorizations.capture',
        body: {},
        retries: 3,
      })
      .catch((e: unknown) => e)) as PayPalApiError;
    expect(hits).toBe(1);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({
      status: 422,
      retryable: false,
      kind: 'authorization_expired',
      debugId: 'dbg-42',
      issue: 'AUTHORIZATION_EXPIRED',
    });
  });

  it('wraps network failures as retryable PayPalNetworkError', async () => {
    server.use(tokenHandler());
    server.use(http.get(`${BASE}/v2/checkout/orders/O1`, () => HttpResponse.error()));
    const { http: client } = await makeClient();
    const err = await client
      .request({ method: 'GET', path: '/v2/checkout/orders/O1', operation: 'orders.get' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalNetworkError);
    expect((err as PayPalNetworkError).retryable).toBe(true);
  });

  it('falls back to the paypal-debug-id header', async () => {
    server.use(tokenHandler());
    server.use(
      http.get(`${BASE}/v2/checkout/orders/NOPE`, () =>
        HttpResponse.json(
          { name: 'RESOURCE_NOT_FOUND' },
          { status: 404, headers: { 'paypal-debug-id': 'hdr-dbg' } },
        ),
      ),
    );
    const { http: client } = await makeClient();
    const err = (await client
      .request({ method: 'GET', path: '/v2/checkout/orders/NOPE', operation: 'orders.get' })
      .catch((e: unknown) => e)) as PayPalApiError;
    expect(err).toMatchObject({ status: 404, kind: 'not_found', debugId: 'hdr-dbg' });
  });
});

describe('error mapping table', () => {
  const cases: [number, string | undefined, string, boolean][] = [
    [422, 'AUTHORIZATION_EXPIRED', 'authorization_expired', false],
    [422, 'PREVIOUSLY_CAPTURED', 'already_captured', false],
    [422, 'MAX_CAPTURE_AMOUNT_EXCEEDED', 'capture_amount_exceeded', false],
    [422, 'REFUND_AMOUNT_EXCEEDED', 'refund_amount_exceeded', false],
    [422, 'TRANSACTION_DISPUTED', 'transaction_disputed', false],
    [422, 'TRANSACTION_REFUSED', 'transaction_refused', false],
    [422, 'CAPTURE_STATUS_NOT_VALID', 'capture_status_not_valid', false],
    [422, 'ORDER_NOT_APPROVED', 'order_not_approved', false],
    [422, 'SOME_NEW_ISSUE', 'validation', false],
    [400, 'INVALID_PARAMETER_VALUE', 'validation', false],
    [403, undefined, 'forbidden', false],
    [404, undefined, 'not_found', false],
    [409, undefined, 'conflict', false],
    [429, undefined, 'rate_limited', true],
    [500, undefined, 'server_error', true],
    [503, undefined, 'server_error', true],
  ];

  it.each(cases)('%i %s → %s (retryable=%s)', (status, issue, kind, retryable) => {
    const err = new PayPalApiError(status, {
      name: 'X',
      message: 'm',
      details: issue ? [{ issue }] : [],
    });
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
    expect(isRetryableStatus(status)).toBe(retryable);
  });

  it('every mapped issue resolves to a kind', () => {
    for (const [issue, kind] of Object.entries(ISSUE_KINDS)) {
      expect(new PayPalApiError(422, { details: [{ issue }] }).kind).toBe(kind);
    }
  });

  it('tolerates non-JSON error bodies', () => {
    const err = new PayPalApiError(502, '<html>bad gateway</html>');
    expect(err).toMatchObject({ kind: 'server_error', retryable: true, details: [] });
  });
});

describe('idempotency', () => {
  it('derives a stable 36-char id per (proposal, operation)', () => {
    const a = paypalRequestId('p-1', 'authorizations.capture');
    expect(a).toHaveLength(36);
    expect(paypalRequestId('p-1', 'authorizations.capture')).toBe(a);
    expect(paypalRequestId('p-1', 'authorizations.void')).not.toBe(a);
    expect(paypalRequestId('p-2', 'authorizations.capture')).not.toBe(a);
  });

  it('knows each API retention window', () => {
    const t0 = new Date('2026-11-02T00:00:00Z');
    expect(retentionUntil('orders.capture', t0)?.toISOString()).toBe('2026-11-02T06:00:00.000Z');
    expect(retentionUntil('subscriptions.capture', t0)?.toISOString()).toBe(
      '2026-11-05T00:00:00.000Z',
    );
    expect(retentionUntil('orders.track', t0)).toBeNull();
    expect(supportsRequestId('subscriptions.suspend')).toBe(false);
    expect(Object.keys(OPERATIONS).length).toBeGreaterThan(10);
  });

  it('never allows a blind retry past retention', () => {
    const t0 = new Date('2026-11-02T00:00:00Z');
    const until = retentionUntil('captures.refund', t0);
    expect(canRetryWithSameId(until, new Date('2026-11-02T05:59:59Z'))).toBe(true);
    expect(canRetryWithSameId(until, new Date('2026-11-02T06:00:00Z'))).toBe(false);
    expect(canRetryWithSameId(null, t0)).toBe(false);
  });
});

describe('redaction', () => {
  it('hides auth headers and secret body fields', () => {
    expect(redactHeaders({ Authorization: 'Bearer x', 'PayPal-Request-Id': 'r' })).toEqual({
      Authorization: REDACTED,
      'PayPal-Request-Id': 'r',
    });
    expect(
      redactBody({ access_token: 't', payment_source: { card: { number: '4111', name: 'A' } } }),
    ).toEqual({
      access_token: REDACTED,
      payment_source: { card: { number: REDACTED, name: 'A' } },
    });
  });
});
