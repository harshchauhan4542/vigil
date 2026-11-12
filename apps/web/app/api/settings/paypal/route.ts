// The merchant's PayPal sandbox app, managed from the Settings page.
// GET: connection status (never the secret). POST: test the keys with PayPal, then save them
// encrypted and restart Live. DELETE: forget saved keys. Changes need ADMIN_PASSCODE.
import { json, rateLimited } from '../../../../lib/guards';
import { passcodeMatches } from '../../../../lib/secret-box';
import { clearPayPal, readSavedPayPal, savePayPal } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const SANDBOX = 'https://api-m.sandbox.paypal.com';
const KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;
const WEBHOOK_RE = /^[A-Za-z0-9]{8,64}$/;

const ending = (id: string | undefined) => (id ? `…${id.slice(-4)}` : null);

async function status() {
  const saved = await readSavedPayPal().catch(() => null);
  const envId = process.env.PAYPAL_CLIENT_ID;
  return {
    connected: !!(saved || envId),
    source: saved ? 'settings' : envId ? 'server' : 'none',
    clientIdEnding: ending(saved?.clientId ?? envId),
    webhookIdSet: !!(saved?.webhookId || process.env.PAYPAL_WEBHOOK_ID),
    savedAt: saved?.savedAt ?? null,
    sandbox: (process.env.PAYPAL_BASE_URL || SANDBOX) === SANDBOX,
    canEdit: !!process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.length >= 8,
  };
}

function locked() {
  return json(
    {
      error: 'locked',
      message:
        'Changing PayPal keys is turned off. Whoever runs Vigil must set ADMIN_PASSCODE (8+ characters) on the server first.',
    },
    403,
  );
}

async function checkPasscode(req: Request, body: { passcode?: unknown }) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || expected.length < 8) return locked();
  if (typeof body.passcode !== 'string' || !passcodeMatches(body.passcode, expected)) {
    return json({ error: 'passcode', message: 'That admin passcode is not right.' }, 401);
  }
  return null;
}

/** Ask PayPal for an access token with these keys: proves they work, nothing else. */
async function testKeys(clientId: string, secret: string): Promise<boolean> {
  const base = process.env.PAYPAL_BASE_URL || SANDBOX;
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return !!res?.ok;
}

export async function GET() {
  return json(await status());
}

export async function POST(req: Request) {
  const limited = rateLimited('settings', 5, 10 * 60_000, req);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const denied = await checkPasscode(req, body);
  if (denied) return denied;

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  const webhookId = typeof body.webhookId === 'string' ? body.webhookId.trim() : '';
  if (!KEY_RE.test(clientId) || !KEY_RE.test(secret)) {
    return json(
      {
        error: 'invalid',
        message: 'The Client ID and Secret look wrong. Copy them again from your PayPal app.',
      },
      400,
    );
  }
  if (webhookId && !WEBHOOK_RE.test(webhookId)) {
    return json({ error: 'invalid', message: 'The Webhook ID looks wrong.' }, 400);
  }
  if (!(await testKeys(clientId, secret))) {
    return json(
      {
        error: 'paypal',
        message:
          'PayPal did not accept these keys. Check they are from a Sandbox app (not Live) and copied in full.',
      },
      400,
    );
  }
  await savePayPal({
    clientId,
    secret,
    ...(webhookId ? { webhookId } : {}),
    savedAt: new Date().toISOString(),
  });
  return json({ ok: true, ...(await status()) });
}

export async function DELETE(req: Request) {
  const limited = rateLimited('settings', 5, 10 * 60_000, req);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const denied = await checkPasscode(req, body);
  if (denied) return denied;
  await clearPayPal();
  return json({ ok: true, ...(await status()) });
}
