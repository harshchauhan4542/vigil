import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryCache } from '../src/cache.js';
import { createPayPalClient } from '../src/client.js';

export const BASE = 'https://api-m.sandbox.paypal.com';
export const server = setupServer();

export const tokenHandler = (
  opts: { token?: string; expiresIn?: number; calls?: { n: number } } = {},
) =>
  http.post(`${BASE}/v1/oauth2/token`, async ({ request }) => {
    if (opts.calls) opts.calls.n++;
    const body = await request.text();
    if (
      body !== 'grant_type=client_credentials' ||
      !request.headers.get('authorization')?.startsWith('Basic ')
    ) {
      return HttpResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    return HttpResponse.json({
      access_token: opts.token ?? `A21.token-${opts.calls?.n ?? 1}`,
      token_type: 'Bearer',
      expires_in: opts.expiresIn ?? 32400,
      scope: 'https://uri.paypal.com/services/payments/payment',
    });
  });

export async function makeClient(overrides: { now?: () => number; cache?: MemoryCache } = {}) {
  const cache = overrides.cache ?? new MemoryCache(overrides.now);
  return createPayPalClient({
    clientId: 'test-client',
    secret: 'test-secret',
    baseUrl: BASE,
    cache,
    sleep: async () => {},
    ...(overrides.now ? { now: overrides.now } : {}),
  });
}
