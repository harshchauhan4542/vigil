// AgLlmAdapter for AG Studio's built-in agents, served by Claude through /api/ai.
import type { AgAiEvent, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from 'ag-studio';

/** AG-UI events that replay a finished response (text, then any tool calls). */
export function responseToEvents(res: AgLlmResponse): AgAiEvent[] {
  const events: AgAiEvent[] = [];
  for (const item of res.output) {
    if (item.type === 'message') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('');
      events.push({ type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' });
      if (text) events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: text });
      events.push({ type: 'TEXT_MESSAGE_END', messageId: item.id });
    } else if (item.type === 'function_call') {
      events.push({ type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name });
      events.push({ type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments });
      events.push({ type: 'TOOL_CALL_END', toolCallId: item.callId });
    }
  }
  return events;
}

export function createAnthropicAdapter(endpoint = '/api/ai'): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options) {
      const complete: Promise<AgLlmResponse> = fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        ...(options?.signal ? { signal: options.signal } : {}),
      }).then(async (r) => {
        const body = (await r.json()) as AgLlmResponse | { error: string; hint?: string };
        if (!r.ok || 'error' in body) {
          const e = body as { error?: string; hint?: string };
          return {
            id: `error_${Date.now()}`,
            createdAt: Date.now(),
            status: 'failed',
            error: {
              code: e.error ?? String(r.status),
              message: e.hint ?? e.error ?? 'AI request failed',
            },
            output: [],
          } satisfies AgLlmResponse;
        }
        return body as AgLlmResponse;
      });
      return {
        complete,
        stream: {
          async *[Symbol.asyncIterator]() {
            yield* responseToEvents(await complete);
          },
        },
      };
    },
  };
}
