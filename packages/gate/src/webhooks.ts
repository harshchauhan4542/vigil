// Webhook receiver, framework-agnostic (the Next.js route is a thin wrapper).
// Raw bytes are stored first, then verified; duplicates (same event id) are acknowledged and
// ignored; processing happens in the process_webhook task so PayPal gets its 2xx quickly.
import { getWebhookEvent, insertWebhookEvent, transitionWebhookEvent, type Db } from '@vigil/db';
import { verifyWebhook, type CertCache, type PayPalHttp } from '@vigil/paypal';
import type { TaskRunner } from '@vigil/tasks';

export interface ReceiveDeps {
  db: Db;
  http: PayPalHttp;
  runner: TaskRunner;
  certs: CertCache;
  webhookId: string | undefined;
  allowSimulated: boolean;
  /** false: self-verification only (offline tests). */
  postback?: boolean;
}

export interface ReceiveResult {
  status: 200 | 400;
  body: {
    ok: boolean;
    duplicate?: boolean;
    event_id?: string;
    simulated?: boolean;
    error?: string;
  };
}

const KEPT_HEADERS = [
  'paypal-transmission-id',
  'paypal-transmission-time',
  'paypal-cert-url',
  'paypal-auth-algo',
  'paypal-transmission-sig',
  'content-type',
  'user-agent',
];

export async function receiveWebhook(
  deps: ReceiveDeps,
  rawBody: Uint8Array,
  headers: Headers,
): Promise<ReceiveResult> {
  let event: {
    id?: string;
    event_type?: string;
    resource_type?: string;
    resource?: { id?: string };
  };
  try {
    event = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return { status: 400, body: { ok: false, error: 'body is not JSON' } };
  }
  if (!event.id || !event.event_type)
    return { status: 400, body: { ok: false, error: 'missing event id or type' } };

  const kept: Record<string, string> = {};
  for (const h of KEPT_HEADERS) {
    const v = headers.get(h);
    if (v) kept[h] = v;
  }
  const time = headers.get('paypal-transmission-time');
  const stored = await insertWebhookEvent(deps.db, {
    eventId: event.id,
    eventType: event.event_type,
    resourceType: event.resource_type ?? null,
    resourceId: event.resource?.id ?? null,
    transmissionId: headers.get('paypal-transmission-id'),
    transmissionTime: time && !Number.isNaN(Date.parse(time)) ? new Date(time) : null,
    headers: kept,
    rawBody,
  });
  if (!stored) {
    // PayPal retries up to 25 times: acknowledge, do nothing.
    const prev = await getWebhookEvent(deps.db, event.id);
    return {
      status: 200,
      body: { ok: true, duplicate: true, event_id: event.id, simulated: prev?.simulated ?? false },
    };
  }

  const v = await verifyWebhook({
    http: deps.http,
    headers,
    rawBody,
    webhookId: deps.webhookId,
    allowSimulated: deps.allowSimulated,
    certs: deps.certs,
    ...(deps.postback === false ? { postback: false } : {}),
  });
  if (!v.verified) {
    await transitionWebhookEvent(deps.db, event.id, 'RECEIVED', 'REJECTED', {
      verificationMethod: v.method,
      verificationStatus: 'FAILURE',
      error: v.reason ?? 'verification failed',
    });
    return {
      status: 400,
      body: { ok: false, event_id: event.id, error: 'signature verification failed' },
    };
  }
  await transitionWebhookEvent(deps.db, event.id, 'RECEIVED', 'VERIFIED', {
    verificationMethod: v.method,
    verificationStatus: 'SUCCESS',
    simulated: v.simulated,
  });
  await deps.runner.start('process_webhook', [event.id]);
  return { status: 200, body: { ok: true, event_id: event.id, simulated: v.simulated } };
}
