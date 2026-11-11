// Live ⇄ Replay, per judge (cookie). Replay serves recorded PayPal + Claude responses: zero keys.
import { VigilMode } from '@vigil/core';
import { MODE_COOKIE, json } from '../../../../lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const parsed = VigilMode.safeParse(body.mode);
  if (!parsed.success) return json({ error: 'mode must be "live" or "replay"' }, 400);
  return json({ ok: true, mode: parsed.data }, 200, {
    'set-cookie': `${MODE_COOKIE}=${parsed.data}; Path=/; SameSite=Lax; Max-Age=2592000`,
  });
}
