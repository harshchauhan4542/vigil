// PayPal webhook receiver: raw body bytes → store → verify → 2xx → process_webhook.
// Always Live (PayPal is calling us), whatever the judge's mode cookie says.
import { receiveWebhook } from '@vigil/gate';
import { json } from '../../../../lib/guards';
import { getServer } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > 512 * 1024) return json({ error: 'too large' }, 413);
  const s = await getServer('live');
  // Can't verify or settle without Live; a non-2xx makes PayPal retry later (up to 3 days).
  if (s.fallback) return json({ error: 'live unavailable', reason: s.fallback.reason }, 503);
  const r = await receiveWebhook(s.webhooks, raw, req.headers);
  return json(r.body, r.status);
}
