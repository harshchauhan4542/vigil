// OAuth client-credentials token: cached (memory or Redis), refreshed 5 minutes before expiry,
// single-flight within a process and (via a cache lock) across web + workflow processes.
import type { KvCache } from './cache.js';
import { PayPalAuthError, PayPalNetworkError } from './errors.js';
import { silentLogger, type Logger } from './logger.js';

export const REFRESH_MARGIN_MS = 5 * 60_000;
const LOCK_TTL_MS = 15_000;
const LOCK_WAIT_STEP_MS = 100;
const LOCK_WAIT_MAX_MS = 5_000;

export interface AccessToken {
  accessToken: string;
  tokenType: string;
  /** Epoch ms when PayPal says the token expires. */
  expiresAt: number;
  scope?: string;
}

export interface TokenProviderOptions {
  clientId: string;
  secret: string;
  baseUrl: string;
  cache: KvCache;
  fetch?: typeof fetch;
  now?: () => number;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

export class TokenProvider {
  private inflight: Promise<AccessToken> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: TokenProviderOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? silentLogger;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get cacheKey(): string {
    return `pp:token:${this.options.clientId}`;
  }

  private get lockKey(): string {
    return `pp:token-lock:${this.options.clientId}`;
  }

  /** A token valid for at least REFRESH_MARGIN_MS more. */
  async getToken(): Promise<AccessToken> {
    const cached = await this.readCache();
    if (cached) return cached;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Drop the cached token (after a 401) so the next call fetches a fresh one. */
  async invalidate(): Promise<void> {
    await this.options.cache.del(this.cacheKey);
  }

  private async readCache(): Promise<AccessToken | null> {
    const raw = await this.options.cache.get(this.cacheKey);
    if (!raw) return null;
    const token = JSON.parse(raw) as AccessToken;
    return token.expiresAt - this.now() > REFRESH_MARGIN_MS ? token : null;
  }

  private async refresh(): Promise<AccessToken> {
    const release = await this.options.cache.tryLock(this.lockKey, LOCK_TTL_MS);
    if (!release) {
      // Another process is refreshing: wait for its result, then fall back to fetching ourselves.
      for (let waited = 0; waited < LOCK_WAIT_MAX_MS; waited += LOCK_WAIT_STEP_MS) {
        await this.sleep(LOCK_WAIT_STEP_MS);
        const cached = await this.readCache();
        if (cached) return cached;
      }
    }
    try {
      const token = await this.fetchToken();
      const ttl = token.expiresAt - this.now() - REFRESH_MARGIN_MS;
      if (ttl > 0) await this.options.cache.set(this.cacheKey, JSON.stringify(token), ttl);
      return token;
    } finally {
      await release?.();
    }
  }

  private async fetchToken(): Promise<AccessToken> {
    const { clientId, secret, baseUrl } = this.options;
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl(new URL('/v1/oauth2/token', baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (cause) {
      throw new PayPalNetworkError('PayPal OAuth request failed', { cause });
    }
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new PayPalAuthError(res.status, body.error, body.error_description);
    }
    const expiresAt = this.now() + (body.expires_in ?? 0) * 1000;
    this.logger.info({ expires_in: body.expires_in }, 'paypal token fetched');
    return {
      accessToken: body.access_token,
      tokenType: body.token_type ?? 'Bearer',
      expiresAt,
      ...(body.scope ? { scope: body.scope } : {}),
    };
  }
}
