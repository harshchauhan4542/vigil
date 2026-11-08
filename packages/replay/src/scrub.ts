// Scrubbing: nothing secret is ever written to a recording. Keys that look secret are replaced,
// and every known secret value (API keys, client secret, tokens) is removed from any string.

export const SCRUBBED = '[SCRUBBED]';

const SECRET_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'api_key',
  'apikey',
  'password',
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'security_code',
  'cvv',
  'number', // card numbers
]);

/** Response headers worth keeping for replay; everything else is dropped. */
export const KEPT_RESPONSE_HEADERS = ['content-type', 'paypal-debug-id', 'request-id'];

function scrubString(s: string, secrets: readonly string[]): string {
  let out = s;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join(SCRUBBED);
  }
  // Bearer / Basic credentials that slipped into text.
  return out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${SCRUBBED}`);
}

export function scrubValue(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value, secrets);
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, secrets, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? SCRUBBED : scrubValue(v, secrets, depth + 1);
  }
  return out;
}

/** Scrub a text body: JSON is scrubbed structurally, anything else (SSE, forms) textually. */
export function scrubBody(text: string, secrets: readonly string[]): string {
  try {
    return JSON.stringify(scrubValue(JSON.parse(text), secrets));
  } catch {
    return scrubSse(text, secrets);
  }
}

/** Server-sent events: scrub each `data:` JSON line. */
function scrubSse(text: string, secrets: readonly string[]): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.startsWith('data:')) return scrubString(line, secrets);
      const payload = line.slice(5).trim();
      try {
        return `data: ${JSON.stringify(scrubValue(JSON.parse(payload), secrets))}`;
      } catch {
        return `data: ${scrubString(payload, secrets)}`;
      }
    })
    .join('\n');
}
