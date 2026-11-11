// "Vigil Ops" Studio agent: a custom runner that streams the server-side Claude loop
// (/api/agent/stream: read tools + DRAFT proposals) and translates it into AG-UI events.
import { clientToolRunner, type AgAiEvent, type AgAiRunInput } from 'ag-studio';

export const VIGIL_OPS_ID = 'vigil-ops';

/** The newest user text in the thread. */
export function lastUserText(input: AgAiRunInput): string {
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const m = input.messages[i] as {
      kind?: string;
      role?: string;
      content?: { type: string; text?: string }[];
    };
    if (m.kind === 'input' && m.role === 'user') {
      return (m.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('\n');
    }
  }
  return '';
}

/** Parse an SSE body into (event, data) pairs. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

/** Server agent events → AG-UI events. */
export async function* toAgUi(
  input: AgAiRunInput,
  events: AsyncIterable<{ event: string; data: unknown }>,
): AsyncGenerator<AgAiEvent> {
  const messageId = `${input.runId}_text`;
  let textOpen = false;
  yield { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId };
  for await (const { event, data } of events) {
    const d = data as Record<string, unknown>;
    if (event === 'text') {
      if (!textOpen) {
        yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
        textOpen = true;
      }
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: String(d.delta ?? '') };
    } else if (event === 'tool_call') {
      const id = String(d.id);
      yield { type: 'TOOL_CALL_START', toolCallId: id, toolCallName: String(d.name) };
      yield { type: 'TOOL_CALL_ARGS', toolCallId: id, delta: JSON.stringify(d.input ?? {}) };
      yield { type: 'TOOL_CALL_END', toolCallId: id };
    } else if (event === 'tool_result') {
      yield {
        type: 'TOOL_CALL_RESULT',
        messageId: `${String(d.id)}_result`,
        toolCallId: String(d.id),
        content: d.isError ? 'error' : 'ok',
        role: 'tool',
      };
    } else if (event === 'policy') {
      const note = `\n\nProposal ${String(d.proposalId).slice(0, 8)}… policy: ${String(d.verdict)} (T${String(d.tier)}). Approve it in the Proposal Card.`;
      if (!textOpen) {
        yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
        textOpen = true;
      }
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: note };
    } else if (event === 'error') {
      yield { type: 'RUN_ERROR', message: String(d.message ?? 'agent error') };
      return;
    }
  }
  if (textOpen) yield { type: 'TEXT_MESSAGE_END', messageId };
  yield { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId };
}

export const vigilOpsAgent = clientToolRunner({
  id: VIGIL_OPS_ID,
  name: 'Vigil Ops',
  description:
    "Investigates the merchant's PayPal money exceptions (holds expiring, unmatched transactions, failed renewals, untracked shipments) and drafts fixes. Drafts still need policy checks and human approval. Use for any question about money, exceptions or proposals.",
  maxTurns: 1,
  run(input, ctx) {
    return {
      async *[Symbol.asyncIterator]() {
        const res = await fetch('/api/agent/stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: lastUserText(input) }),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
          yield {
            type: 'RUN_ERROR',
            message: err.hint ?? err.error ?? `HTTP ${res.status}`,
          } as AgAiEvent;
          return;
        }
        yield* toAgUi(input, readSse(res.body));
      },
    };
  },
});
