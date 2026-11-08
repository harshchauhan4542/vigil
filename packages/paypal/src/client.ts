// One place to build the PayPal token provider + HTTP client from config.
import { createCache, type KvCache } from './cache.js';
import { PayPalHttp } from './http.js';
import { silentLogger, type Logger } from './logger.js';
import { TokenProvider } from './token.js';

export interface PayPalClientOptions {
  clientId: string;
  secret: string;
  baseUrl: string;
  cache?: KvCache;
  redisUrl?: string | undefined;
  fetch?: typeof fetch;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PayPalClient {
  tokens: TokenProvider;
  http: PayPalHttp;
}

export async function createPayPalClient(options: PayPalClientOptions): Promise<PayPalClient> {
  const cache = options.cache ?? (await createCache(options.redisUrl));
  const logger = options.logger ?? silentLogger;
  const shared = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    logger,
  };
  const tokens = new TokenProvider({
    clientId: options.clientId,
    secret: options.secret,
    baseUrl: options.baseUrl,
    cache,
    ...(options.now ? { now: options.now } : {}),
    ...shared,
  });
  const http = new PayPalHttp({ baseUrl: options.baseUrl, tokens, ...shared });
  return { tokens, http };
}
