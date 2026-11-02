import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CertCache,
  SIMULATOR_WEBHOOK_ID,
  isPayPalCertUrl,
  signedMessage,
  verifyWebhook,
  type TransmissionHeaders,
} from '../src/webhooks-verify.js';
import { BASE, makeClient, server, tokenHandler } from './helpers.js';

const CERT = readFileSync(
  new URL('../../../fixtures/webhooks/test-cert.pem', import.meta.url),
  'utf8',
);
const KEY = readFileSync(
  new URL('../../../fixtures/webhooks/test-key.pem', import.meta.url),
  'utf8',
);
const CERT_URL = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-test';
const WEBHOOK_ID = '8PT597110X687430LKGECATA';
const body = new TextEncoder().encode(
  '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP-1"}}',
);

function signedHeaders(raw: Uint8Array, webhookId = WEBHOOK_ID): Record<string, string> {
  const t: TransmissionHeaders = {
    transmissionId: '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
    transmissionTime: '2026-11-05T12:00:00Z',
    transmissionSig: '',
    certUrl: CERT_URL,
    authAlgo: 'SHA256withRSA',
  };
  const sig = sign('sha256', Buffer.from(signedMessage(t, webhookId, raw)), KEY).toString('base64');
  return {
    'paypal-transmission-id': t.transmissionId,
    'paypal-transmission-time': t.transmissionTime,
    'paypal-transmission-sig': sig,
    'paypal-cert-url': t.certUrl,
    'paypal-auth-algo': t.authAlgo,
  };
}

const certs = () => new CertCache(async () => new Response(CERT));

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function check(
  raw: Uint8Array,
  headers: Record<string, string>,
  over: { allowSimulated?: boolean; webhookId?: string } = {},
) {
  server.use(tokenHandler());
  const { http: client } = await makeClient();
  return verifyWebhook({
    http: client,
    headers,
    rawBody: raw,
    webhookId: 'webhookId' in over ? over.webhookId : WEBHOOK_ID,
    allowSimulated: over.allowSimulated ?? false,
    certs: certs(),
    postback: false,
  });
}

describe('webhook self-verification', () => {
  it('a valid signature passes', async () => {
    expect(await check(body, signedHeaders(body))).toEqual({
      verified: true,
      method: 'self',
      simulated: false,
    });
  });

  it('a tampered body fails', async () => {
    const tampered = new TextEncoder().encode(
      '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP-2"}}',
    );
    expect((await check(tampered, signedHeaders(body))).verified).toBe(false);
  });

  it('a bad signature fails', async () => {
    const h = signedHeaders(body);
    h['paypal-transmission-sig'] = Buffer.from('nope').toString('base64');
    expect((await check(body, h)).verified).toBe(false);
  });

  it('missing headers or a non-PayPal cert URL fail before any fetch', async () => {
    expect(await check(body, {})).toMatchObject({
      verified: false,
      reason: expect.stringContaining('headers'),
    });
    const h = { ...signedHeaders(body), 'paypal-cert-url': 'https://evil.example.com/cert.pem' };
    expect(await check(body, h)).toMatchObject({
      verified: false,
      reason: expect.stringContaining('PayPal host'),
    });
    expect(isPayPalCertUrl('http://api.paypal.com/x')).toBe(false);
    expect(isPayPalCertUrl('https://api.paypal.com.evil.com/x')).toBe(false);
    expect(isPayPalCertUrl('https://api.sandbox.paypal.com/x')).toBe(true);
  });

  it('simulator events (signed with "WEBHOOK_ID") verify only when allowed, and are marked simulated', async () => {
    const h = signedHeaders(body, SIMULATOR_WEBHOOK_ID);
    expect((await check(body, h)).verified).toBe(false);
    expect(await check(body, h, { allowSimulated: true })).toEqual({
      verified: true,
      method: 'self_simulated',
      simulated: true,
    });
  });

  it('CRC32 is decimal and unsigned over the raw bytes', () => {
    const t = {
      transmissionId: 'a',
      transmissionTime: 'b',
      transmissionSig: '',
      certUrl: '',
      authAlgo: '',
    };
    expect(signedMessage(t, 'W', new TextEncoder().encode('hello'))).toBe('a|b|W|907060870');
  });
});

describe('webhook postback verification', () => {
  it('posts the event back byte-for-byte and accepts SUCCESS', async () => {
    let sent = '';
    server.use(
      tokenHandler(),
      http.post(`${BASE}/v1/notifications/verify-webhook-signature`, async ({ request }) => {
        sent = await request.text();
        return HttpResponse.json({ verification_status: 'SUCCESS' });
      }),
    );
    const { http: client } = await makeClient();
    const raw = new TextEncoder().encode('{"id":"WH-9",  "event_type":"X"}'); // odd spacing must survive
    const r = await verifyWebhook({
      http: client,
      headers: signedHeaders(raw),
      rawBody: raw,
      webhookId: WEBHOOK_ID,
      allowSimulated: false,
      certs: certs(),
    });
    expect(r).toEqual({ verified: true, method: 'postback', simulated: false });
    expect(sent).toContain('"webhook_event":{"id":"WH-9",  "event_type":"X"}');
    expect(JSON.parse(sent)).toMatchObject({ webhook_id: WEBHOOK_ID, auth_algo: 'SHA256withRSA' });
  });

  it('falls back to self-verification when the postback says FAILURE', async () => {
    server.use(
      tokenHandler(),
      http.post(`${BASE}/v1/notifications/verify-webhook-signature`, () =>
        HttpResponse.json({ verification_status: 'FAILURE' }),
      ),
    );
    const { http: client } = await makeClient();
    const r = await verifyWebhook({
      http: client,
      headers: signedHeaders(body),
      rawBody: body,
      webhookId: WEBHOOK_ID,
      allowSimulated: false,
      certs: certs(),
    });
    expect(r.method).toBe('self');
  });
});
