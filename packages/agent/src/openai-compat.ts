// An OpenAI-compatible chat-completions provider (Groq, Gemini's OpenAI endpoint, OpenRouter,
// a local Ollama…) behind the same surface as the Anthropic client: `messages.stream(params)`
// with `.on('text')` + `.finalMessage()`, and `messages.create(params)`. Requests are written in
// the Messages API shape everywhere else in Vigil; this file translates them both ways, so the
// agent loop, the Studio route, the policy engine and the trust boundary are unchanged.
// Claude-only knobs (thinking, effort, cache_control, strict) are dropped: no equivalent here.
import type Anthropic from '@anthropic-ai/sdk';
import { createReplayFetch, type FixtureStore } from '@vigil/replay';

export interface OpenAICompatClientOptions {
  mode: 'live' | 'replay';
  /** e.g. https://api.groq.com/openai/v1 (no trailing /chat/completions). */
  baseURL: string;
  /** Required in live mode. Never logged or recorded. */
  apiKey?: string | undefined;
  store: FixtureStore;
  record?: boolean;
  /** Upper bound on max_tokens sent to the provider (free tiers cap output per request). */
  maxOutputTokens?: number;
  baseFetch?: typeof fetch;
  /** Waits between retries; injectable so tests don't sleep. */
  sleep?: (ms: number) => Promise<void>;
}

// ---- OpenAI wire shapes (only the fields Vigil uses) ----
interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export type OaiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface OaiRequest {
  model: string;
  messages: OaiMessage[];
  max_tokens: number;
  tools?: {
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'json_object' };
}
interface OaiResponse {
  id?: string;
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; tool_calls?: OaiToolCall[] | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class LlmApiError extends Error {
  override name = 'LlmApiError';
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

type Params = Anthropic.MessageCreateParams & {
  output_config?: { format?: { type?: string; schema?: unknown } };
};

function blockText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? (b.text ?? '') : b.type === 'image' ? '[image omitted]' : ''))
    .filter(Boolean)
    .join('\n');
}

/** Messages API request → chat-completions request. Pure; exported for tests. */
export function toOpenAIRequest(params: Params, maxOutputTokens = 8192): OaiRequest {
  const messages: OaiMessage[] = [];
  const systemParts: string[] = [];
  if (params.system) systemParts.push(blockText(params.system as Anthropic.TextBlockParam[]));
  const format = params.output_config?.format;
  if (format?.type === 'json_schema') {
    systemParts.push(
      `Reply with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(format.schema)}`,
    );
  }
  if (systemParts.length) messages.push({ role: 'system', content: systemParts.join('\n\n') });

  for (const m of params.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text: string[] = [];
      const calls: OaiToolCall[] = [];
      for (const b of m.content) {
        if (b.type === 'text') text.push(b.text);
        else if (b.type === 'tool_use') {
          calls.push({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
        }
        // thinking / redacted_thinking blocks are Claude-specific and never sent here.
      }
      messages.push({
        role: 'assistant',
        content: text.join('') || (calls.length ? null : ''),
        ...(calls.length ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // user: tool results become `tool` messages (they must follow the assistant turn directly);
    // any other text in the same turn follows as a user message.
    const text: string[] = [];
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const body = blockText((b.content ?? '') as string | { type: string; text?: string }[]);
        messages.push({
          role: 'tool',
          tool_call_id: b.tool_use_id,
          content: b.is_error ? `ERROR: ${body}` : body,
        });
      } else if (b.type === 'text') text.push(b.text);
      else if (b.type === 'image') text.push('[image omitted]');
    }
    if (text.length) messages.push({ role: 'user', content: text.join('\n') });
  }

  const req: OaiRequest = {
    model: params.model,
    messages,
    max_tokens: Math.min(params.max_tokens, maxOutputTokens),
  };
  const tools = (params.tools ?? []).filter(
    (t): t is Anthropic.Tool => 'input_schema' in t && !!t.input_schema,
  );
  if (tools.length) {
    req.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
    }));
    const tc = params.tool_choice;
    req.tool_choice =
      tc?.type === 'none'
        ? 'none'
        : tc?.type === 'any'
          ? 'required'
          : tc?.type === 'tool'
            ? { type: 'function', function: { name: tc.name } }
            : 'auto';
  } else if (format?.type === 'json_schema') {
    req.response_format = { type: 'json_object' };
  }
  return req;
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    // Not an object, so the tool's Zod schema rejects it and the model sees why.
    return { invalid_json_arguments: raw };
  }
}

/** Chat-completions response → Messages API `Message`. Pure; exported for tests. */
export function fromOpenAIResponse(res: OaiResponse, model: string): Anthropic.Message {
  const choice = res.choices?.[0];
  const content: (Anthropic.TextBlock | Anthropic.ToolUseBlock)[] = [];
  const text = choice?.message?.content ?? '';
  if (text) content.push({ type: 'text', text, citations: null } as Anthropic.TextBlock);
  const calls = choice?.message?.tool_calls ?? [];
  for (const c of calls) {
    content.push({
      type: 'tool_use',
      id: c.id,
      name: c.function.name,
      input: parseArguments(c.function.arguments),
    } as Anthropic.ToolUseBlock);
  }
  const finish = choice?.finish_reason ?? null;
  const stop_reason: Anthropic.StopReason =
    calls.length || finish === 'tool_calls'
      ? 'tool_use'
      : finish === 'length'
        ? 'max_tokens'
        : finish === 'content_filter'
          ? 'refusal'
          : 'end_turn';
  return {
    id: res.id ?? 'llm_response',
    type: 'message',
    role: 'assistant',
    model: res.model ?? model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function retryDelayMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 2 ** attempt * 1000;
  return Math.min(ms, 30_000);
}

/** The subset of the Anthropic client Vigil uses (`messages.stream` / `messages.create`). */
export function createOpenAICompatClient(options: OpenAICompatClientOptions): Anthropic {
  if (options.mode === 'live' && !options.apiKey) {
    throw new Error('LLM_API_KEY is required when VIGIL_MODE=live and LLM_PROVIDER=openai');
  }
  const transport = createReplayFetch({
    mode: options.mode,
    kind: 'llm',
    store: options.store,
    record: options.record ?? false,
    secrets: options.apiKey ? [options.apiKey] : [],
    ...(options.baseFetch ? { baseFetch: options.baseFetch } : {}),
  });
  const url = `${options.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  // Replay must be deterministic: never retry into a different fixture occurrence.
  const attempts = options.mode === 'replay' ? 1 : MAX_ATTEMPTS;

  async function complete(params: Params): Promise<Anthropic.Message> {
    const body = JSON.stringify(toOpenAIRequest(params, options.maxOutputTokens));
    for (let attempt = 1; ; attempt++) {
      const res = await transport(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.mode === 'live' ? options.apiKey : 'replay-mode-no-key'}`,
        },
        body,
        signal: AbortSignal.timeout(120_000),
      });
      const json = (await res.json().catch(() => ({}))) as OaiResponse & {
        error?: { message?: string; code?: string };
      };
      if (res.ok) return fromOpenAIResponse(json, params.model);
      const code = json.error?.code ?? null;
      // Groq returns 400 tool_use_failed when the model emitted a malformed tool call; a fresh
      // sample usually succeeds. Rate limits and server errors wait for retry-after.
      const retryable = RETRY_STATUS.has(res.status) || code === 'tool_use_failed';
      if (retryable && attempt < attempts) {
        await sleep(retryDelayMs(res, attempt));
        continue;
      }
      const message = (json.error?.message ?? res.statusText ?? 'request failed').slice(0, 300);
      throw new LlmApiError(res.status, `LLM API error ${res.status}: ${message}`, code);
    }
  }

  const client = {
    messages: {
      create: (params: Params) => complete(params),
      // Non-streaming under the hood: the whole text arrives as one 'text' event.
      stream(params: Params) {
        const listeners: ((delta: string) => void)[] = [];
        let result: Promise<Anthropic.Message> | null = null;
        const stream = {
          on(event: string, cb: (delta: string) => void) {
            if (event === 'text') listeners.push(cb);
            return stream;
          },
          finalMessage() {
            result ??= complete(params).then((message) => {
              const text = message.content
                .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('');
              if (text) for (const cb of listeners) cb(text);
              return message;
            });
            return result;
          },
        };
        return stream;
      },
    },
  };
  return client as unknown as Anthropic;
}
