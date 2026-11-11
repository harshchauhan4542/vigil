// The record/replay transport: a `fetch` drop-in used by the PayPal client and the Claude SDK.
//   live            → real network call (optionally recorded)
//   replay          → served from fixtures by request hash; a miss throws (never falls back to live)
import { canonicalJson, sha256Hex } from '@vigil/core';
import { KEPT_RESPONSE_HEADERS, scrubBody, scrubValue } from './scrub.js';
import type { FixtureStore, Recording, RecordingKind } from './store.js';

export type ReplayMode = 'live' | 'replay';

export class ReplayMissError extends Error {
  override name = 'ReplayMissError';
  constructor(
    readonly kind: RecordingKind,
    readonly key: string,
    readonly summary: string,
  ) {
    super(
      `No replay fixture for ${kind} ${summary} (key ${key.slice(0, 12)}…). ` +
        'Record it with VIGIL_MODE=live RECORD=1; replay never falls back to the network.',
    );
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Path plus query with sorted parameters, so key order in a URL never changes the hash. */
/** Time-window query params change with the clock but not the meaning of a recorded call. */
const VOLATILE_PARAMS = new Set(['start_date', 'end_date', 'start_time', 'end_time']);

export function normalizedPath(url: URL): string {
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !VOLATILE_PARAMS.has(k))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  const q = new URLSearchParams(params).toString();
  return q ? `${url.pathname}?${q}` : url.pathname;
}

/** PayPal: sha256(method + path + canonical body). Auth and request-id headers are excluded. */
export function paypalKey(
  method: string,
  url: URL,
  bodyText: string,
  mockHeader?: string | null,
): string {
  const body = parseBody(bodyText);
  // A negative test (PayPal-Mock-Response) is a different recording from the real call.
  const mock = mockHeader ? `mock:${mockHeader}|` : '';
  return sha256Hex(
    `${mock}${method.toUpperCase()} ${normalizedPath(url)}\n${typeof body === 'string' ? body : canonicalJson(body)}`,
  );
}

/** Claude: sha256(model + system + messages + tools). Sampling knobs don't change the key. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The fields of a Claude request that define the conversation, canonicalised. */
function llmCanonical(bodyText: string): string {
  const body = (parseBody(bodyText) ?? {}) as Record<string, unknown>;
  return canonicalJson({
    model: body.model ?? null,
    system: body.system ?? null,
    messages: body.messages ?? null,
    tools: body.tools ?? null,
  });
}

/** Distinct UUIDs in order of first appearance. */
export function uuidsInOrder(text: string): string[] {
  return [...new Set((text.match(UUID_RE) ?? []).map((u) => u.toLowerCase()))];
}

/**
 * Claude: sha256(model + system + messages + tools). Database row ids (UUIDs) differ between a
 * recorded run and its replay, so they are replaced by first-appearance placeholders before
 * hashing; sampling knobs (max_tokens, effort…) don't change the key.
 */
export function llmKey(bodyText: string): string {
  const canonical = llmCanonical(bodyText);
  const order = uuidsInOrder(canonical);
  return sha256Hex(canonical.replace(UUID_RE, (u) => `<uuid:${order.indexOf(u.toLowerCase())}>`));
}

/** Rewrite the recorded run's UUIDs in a replayed body to this run's UUIDs, by position. */
function remapUuids(text: string, recorded: string[], current: string[]): string {
  if (recorded.length === 0) return text;
  return text.replace(UUID_RE, (u) => {
    const i = recorded.indexOf(u.toLowerCase());
    return i >= 0 && current[i] ? current[i]! : u;
  });
}

export interface ReplayFetchOptions {
  mode: ReplayMode;
  kind: RecordingKind;
  store: FixtureStore;
  /** In live mode, save every response. */
  record?: boolean;
  /** Secret values to strip from recordings (client secret, API keys…). */
  secrets?: readonly string[];
  baseFetch?: typeof fetch;
  now?: () => Date;
}

const OAUTH_PATH = '/v1/oauth2/token';

export function createReplayFetch(options: ReplayFetchOptions): typeof fetch {
  const baseFetch = options.baseFetch ?? fetch;
  const secrets = options.secrets ?? [];
  const now = options.now ?? (() => new Date());
  // The same request can legitimately return different answers over a run (GET an
  // authorization before and after capturing it). Recordings are keyed per occurrence.
  const occurrences = new Map<string, number>();
  const occurrenceKey = (base: string, n: number) => (n === 0 ? base : sha256Hex(`${base}#${n}`));

  return async function replayFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const bodyText =
      request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();

    // PayPal OAuth is never recorded; in replay mode it is answered locally (zero keys).
    if (options.kind === 'paypal' && url.pathname === OAUTH_PATH) {
      if (options.mode === 'live') return baseFetch(request);
      return Response.json({
        access_token: 'replay-token',
        token_type: 'Bearer',
        expires_in: 32400,
        scope: 'replay',
      });
    }

    const base =
      options.kind === 'paypal'
        ? paypalKey(request.method, url, bodyText, request.headers.get('paypal-mock-response'))
        : llmKey(bodyText);
    const n = occurrences.get(base) ?? 0;
    occurrences.set(base, n + 1);
    const key = occurrenceKey(base, n);

    if (options.mode === 'replay') {
      // Fall back to the latest earlier occurrence (state unchanged since), never to the network.
      let hit: Recording | null = null;
      for (let i = n; i >= 0 && !hit; i--)
        hit = await options.store.get(options.kind, occurrenceKey(base, i));
      if (!hit) throw new ReplayMissError(options.kind, base, `${request.method} ${url.pathname}`);
      const body =
        options.kind === 'llm'
          ? remapUuids(
              hit.response.body,
              uuidsInOrder(llmCanonical(JSON.stringify(hit.request.body))),
              uuidsInOrder(llmCanonical(bodyText)),
            )
          : hit.response.body;
      return new Response(hit.response.status === 204 ? null : body, {
        status: hit.response.status,
        headers: hit.response.headers,
      });
    }

    const response = await baseFetch(request);
    if (!options.record) return response;

    const text = await response.text();
    const headers: Record<string, string> = {};
    for (const h of KEPT_RESPONSE_HEADERS) {
      const v = response.headers.get(h);
      if (v) headers[h] = v;
    }
    const recording: Recording = {
      key,
      kind: options.kind,
      request: {
        method: request.method,
        url: normalizedPath(url),
        body: scrubValue(parseBody(bodyText), secrets),
      },
      response: { status: response.status, headers, body: scrubBody(text, secrets) },
      recordedAt: now().toISOString(),
    };
    await options.store.put(recording);
    return new Response(response.status === 204 ? null : text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
