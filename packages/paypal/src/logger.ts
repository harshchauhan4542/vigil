// Logging with secrets redacted. Tokens, client secrets and card data never reach a log line.
import { pino } from 'pino';

export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({ level, base: { svc: 'paypal' } });
}

const SECRET_HEADERS = new Set(['authorization', 'paypal-auth-assertion', 'cookie', 'set-cookie']);
const SECRET_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'password',
  'number',
  'security_code',
  'cvv',
  'cvv2',
]);
export const REDACTED = '[REDACTED]';

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

/** Deep copy with secret-looking keys replaced. */
export function redactBody(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactBody(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : redactBody(v, depth + 1);
  }
  return out;
}
