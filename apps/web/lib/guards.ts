// Judge session cookie (signed, no accounts), per-IP rate limits, per-proposal serialisation,
// and JSON helpers for route handlers.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'vigil_session';
export const MODE_COOKIE = 'vigil_mode';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sig(secret: string, id: string) {
  return createHmac('sha256', secret).update(`session|${id}`).digest('base64url');
}

/** Returns the session id from a valid signed cookie, or null. */
export function readSession(req: Request, secret: string): string | null {
  const raw = cookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const [id, s] = raw.split('.');
  if (!id || !s) return null;
  const want = Buffer.from(sig(secret, id));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** Existing session, or a new one plus the Set-Cookie header to send. */
export function ensureSession(req: Request, secret: string): { id: string; setCookie?: string } {
  const id = readSession(req, secret);
  if (id) return { id };
  const fresh = `judge-${randomUUID().slice(0, 8)}`;
  return {
    id: fresh,
    setCookie: `${SESSION_COOKIE}=${fresh}.${sig(secret, fresh)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  };
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  );
}

/** Fixed-window limiter, in memory (one web instance on Render). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true if allowed. */
  take(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    h.count++;
    return h.count <= this.limit;
  }

  retryAfterSeconds(key: string): number {
    const h = this.hits.get(key);
    return h ? Math.max(1, Math.ceil((h.resetAt - this.now()) / 1000)) : 1;
  }
}

const g = globalThis as unknown as {
  __vigilLimiters?: Map<string, RateLimiter>;
  __vigilLocks?: Map<string, Promise<unknown>>;
};

export function limiter(name: string, limit: number, windowMs: number): RateLimiter {
  g.__vigilLimiters ??= new Map();
  let l = g.__vigilLimiters.get(name);
  if (!l) g.__vigilLimiters.set(name, (l = new RateLimiter(limit, windowMs)));
  return l;
}

export function rateLimited(
  name: string,
  limit: number,
  windowMs: number,
  req: Request,
): Response | null {
  const l = limiter(name, limit, windowMs);
  const key = clientIp(req);
  return l.take(key)
    ? null
    : json({ error: 'rate_limited' }, 429, { 'retry-after': String(l.retryAfterSeconds(key)) });
}

/** Run `fn` with no other call for the same key in flight in this process. */
export async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  g.__vigilLocks ??= new Map();
  const prev = g.__vigilLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  g.__vigilLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (g.__vigilLocks.get(key) === run) g.__vigilLocks.delete(key);
  }
}

export function resetGuardsForTests() {
  g.__vigilLimiters = new Map();
  g.__vigilLocks = new Map();
}
