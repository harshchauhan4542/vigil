// Test support: a scripted fake of the Claude Messages API that answers with real SSE streams,
// so the agent loop runs exactly as in production (stream → finalMessage → tools → loop).
// Never imported by production code.
import { http, HttpResponse } from 'msw';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: Record<string, unknown>; id?: string };

export interface FakeTurn {
  content: FakeBlock[];
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
}

export interface FakeRequest {
  model: string;
  system: unknown;
  tools: { name: string; strict?: boolean; input_schema: unknown }[];
  tool_choice?: unknown;
  thinking?: unknown;
  messages: { role: string; content: unknown }[];
}

/** Decides the next assistant turn from the request (e.g. by counting tool results). */
export type FakeScript = (req: FakeRequest, callIndex: number) => FakeTurn;

let idSeq = 0;

export function sse(turn: FakeTurn, model: string): string {
  const events: [string, unknown][] = [];
  const blocks = turn.content.map((b) =>
    b.type === 'tool_use' ? { ...b, id: b.id ?? `toolu_${++idSeq}` } : b,
  );
  events.push([
    'message_start',
    {
      type: 'message_start',
      message: {
        id: `msg_${++idSeq}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 120,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ]);
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      events.push([
        'content_block_start',
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      ]);
      events.push([
        'content_block_delta',
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } },
      ]);
    } else {
      events.push([
        'content_block_start',
        {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} },
        },
      ]);
      events.push([
        'content_block_delta',
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
        },
      ]);
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  const stop =
    turn.stop_reason ?? (blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
  events.push([
    'message_delta',
    {
      type: 'message_delta',
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 40 },
    },
  ]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}

export class FakeClaude {
  requests: FakeRequest[] = [];
  constructor(public script: FakeScript) {}

  handler() {
    return http.post(ANTHROPIC_URL, async ({ request }) => {
      const body = (await request.json()) as FakeRequest;
      this.requests.push(body);
      const turn = this.script(body, this.requests.length - 1);
      return new HttpResponse(sse(turn, body.model), {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
  }
}

/** All tool_result blocks the agent has sent so far, by tool_use id. */
export function toolResults(
  req: FakeRequest,
): { tool_use_id: string; content: string; is_error?: boolean }[] {
  return req.messages
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap(
      (m) =>
        m.content as { type: string; tool_use_id: string; content: string; is_error?: boolean }[],
    )
    .filter((c) => c.type === 'tool_result');
}
