// Typed fetch client for every PayPal REST call Vigil makes.
// Adds auth, JSON headers, Prefer: return=representation and PayPal-Request-Id; retries once on
// 401 with a fresh token; optionally retries 429/5xx/network errors with the SAME request id.
import { PayPalApiError, PayPalError, PayPalNetworkError, isRetryable } from './errors.js';
import { redactBody, redactHeaders, silentLogger, type Logger } from './logger.js';
import { MockNotSupportedError, isMockableOperation } from './mock-response.js';
import type { TokenProvider } from './token.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface PayPalRequest {
  method: HttpMethod;
  path: string;
  /** Short name for logs and recordings, e.g. "authorizations.capture". */
  operation: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** PayPal-Request-Id. Reused unchanged on every retry. */
  requestId?: string;
  /** Raw PayPal-Mock-Response header value (only set via mock-response.ts). */
  mockResponseHeader?: string;
  headers?: Record<string, string>;
  /** Send this exact string as the JSON body instead of JSON.stringify(body). */
  rawJsonBody?: string;
  /** Extra attempts after a retryable failure (429/5xx/network). Default 0. */
  retries?: number;
}

export interface PayPalResponse<T> {
  status: number;
  data: T;
  debugId: string | undefined;
  headers: Headers;
  /** How many attempts were made (1 = no retry). */
  attempts: number;
}

export interface PayPalHttpOptions {
  baseUrl: string;
  tokens: TokenProvider;
  fetch?: typeof fetch;
  logger?: Logger;
  /** Delay before retry n (1-based). Default: 250ms · 2^(n-1). */
  backoff?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

export class PayPalHttp {
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  private readonly backoff: (attempt: number) => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: PayPalHttpOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.logger = options.logger ?? silentLogger;
    this.backoff = options.backoff ?? ((n) => 250 * 2 ** (n - 1));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async request<T>(req: PayPalRequest): Promise<PayPalResponse<T>> {
    // Defence in depth: the header is only honoured by Orders v2 / Payments v2.
    if (req.mockResponseHeader && !isMockableOperation(req.operation)) {
      throw new MockNotSupportedError(req.operation);
    }
    const maxAttempts = 1 + (req.retries ?? 0);
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.send<T>(req);
        return { ...res, attempts: attempt };
      } catch (error) {
        if (attempt >= maxAttempts || !isRetryable(error)) throw error;
        const delay = this.backoff(attempt);
        this.logger.warn(
          { op: req.operation, attempt, delay, request_id: req.requestId, err: String(error) },
          'paypal retry',
        );
        await this.sleep(delay);
      }
    }
  }

  get<T>(path: string, operation: string, query?: PayPalRequest['query']) {
    return this.request<T>({
      method: 'GET',
      path,
      operation,
      ...(query ? { query } : {}),
      retries: 2,
    });
  }

  /** One attempt, plus one more after a 401 with a refreshed token. */
  private async send<T>(req: PayPalRequest): Promise<Omit<PayPalResponse<T>, 'attempts'>> {
    let res = await this.fetchOnce(req, false);
    if (res.status === 401) {
      await this.options.tokens.invalidate();
      res = await this.fetchOnce(req, true);
    }
    const debugId = res.headers.get('paypal-debug-id') ?? undefined;
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const error = new PayPalApiError(res.status, data, debugId);
      this.logger.warn(
        { op: req.operation, status: res.status, debug_id: error.debugId, issue: error.issue },
        'paypal error',
      );
      throw error;
    }
    this.logger.debug(
      { op: req.operation, status: res.status, debug_id: debugId, body: redactBody(data) },
      'paypal response',
    );
    return { status: res.status, data: data as T, debugId, headers: res.headers };
  }

  private async fetchOnce(req: PayPalRequest, isAuthRetry: boolean): Promise<Response> {
    const token = await this.options.tokens.getToken();
    const url = new URL(req.path, this.options.baseUrl);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
      ...(req.body !== undefined || req.rawJsonBody !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(req.method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      ...(req.requestId ? { 'PayPal-Request-Id': req.requestId } : {}),
      ...(req.mockResponseHeader ? { 'PayPal-Mock-Response': req.mockResponseHeader } : {}),
      ...req.headers,
    };
    this.logger.debug(
      {
        op: req.operation,
        method: req.method,
        url: url.pathname + url.search,
        headers: redactHeaders(headers),
        body: redactBody(req.body),
        auth_retry: isAuthRetry,
      },
      'paypal request',
    );
    try {
      return await this.fetchImpl(url, {
        method: req.method,
        headers,
        ...(req.rawJsonBody !== undefined
          ? { body: req.rawJsonBody }
          : req.body !== undefined
            ? { body: JSON.stringify(req.body) }
            : {}),
      });
    } catch (cause) {
      if (cause instanceof PayPalError) throw cause;
      throw new PayPalNetworkError(`${req.operation}: network error`, { cause });
    }
  }
}
