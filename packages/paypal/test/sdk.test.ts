import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createPayPalSdk } from '../src/sdk.js';
import { BASE, makeClient, server, tokenHandler } from './helpers.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('the server SDK reuses the cached token and sends PayPal-Request-Id / PayPal-Mock-Response', async () => {
  const calls = { n: 0 };
  server.use(tokenHandler({ token: 'SHARED', calls }));
  let seen: Headers | undefined;
  server.use(
    http.post(`${BASE}/v2/payments/authorizations/AUTH1/capture`, ({ request }) => {
      seen = request.headers;
      return HttpResponse.json({ id: 'CAP1', status: 'COMPLETED' }, { status: 201 });
    }),
  );
  const { tokens } = await makeClient();
  await tokens.getToken();
  const sdk = createPayPalSdk({ clientId: 'test-client', secret: 's', baseUrl: BASE, tokens });
  const res = await sdk.payments.captureAuthorizedPayment({
    authorizationId: 'AUTH1',
    paypalRequestId: 'req-sdk-1',
    paypalMockResponse: '{"mock_application_codes":"AUTHORIZATION_EXPIRED"}',
    prefer: 'return=representation',
    body: { finalCapture: true },
  });
  expect(res.statusCode).toBe(201);
  expect(calls.n).toBe(1);
  expect(seen?.get('authorization')).toBe('Bearer SHARED');
  expect(seen?.get('paypal-request-id')).toBe('req-sdk-1');
  expect(seen?.get('paypal-mock-response')).toContain('AUTHORIZATION_EXPIRED');
});
