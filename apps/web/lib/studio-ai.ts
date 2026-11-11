// Translation between AG Studio's provider-neutral LLM protocol (AgLlmRequest / AgLlmResponse)
// and the Claude Messages API. Pure functions, used by /api/ai (Plan A from spike S3).
import type {
  AgAiConversationItem,
  AgAiOutputItem,
  AgAiToolSchema,
  AgLlmRequest,
  AgLlmResponse,
} from 'ag-studio';

/** Minimal Claude request/response shapes (the route passes them to the SDK). */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ClaudeBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeBlock[];
}
export interface ClaudeParams {
  system?: string;
  messages: ClaudeMessage[];
  tools?: ClaudeTool[];
  tool_choice?:
    { type: 'auto' } | { type: 'none' } | { type: 'any' } | { type: 'tool'; name: string };
  output_config?: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
}

function push(messages: ClaudeMessage[], role: ClaudeMessage['role'], block: ClaudeBlock) {
  const last = messages.at(-1);
  if (last && last.role === role) last.content.push(block);
  else messages.push({ role, content: [block] });
}

function parseArgs(args: string): unknown {
  try {
    return JSON.parse(args || '{}');
  } catch {
    return {};
  }
}

export function toClaudeParams(req: AgLlmRequest): ClaudeParams {
  const systemParts: string[] = req.instructions ? [req.instructions] : [];
  const messages: ClaudeMessage[] = [];
  for (const item of req.input as AgAiConversationItem[]) {
    if (item.type === 'message' && item.kind === 'input') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      if (item.role === 'system') systemParts.push(text);
      else if (text) push(messages, 'user', { type: 'text', text });
    } else if (item.type === 'message' && item.kind === 'output') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('\n');
      if (text) push(messages, 'assistant', { type: 'text', text });
    } else if (item.type === 'function_call') {
      push(messages, 'assistant', {
        type: 'tool_use',
        id: item.callId,
        name: item.name,
        input: parseArgs(item.arguments),
      });
    } else if (item.type === 'function_call_output') {
      push(messages, 'user', {
        type: 'tool_result',
        tool_use_id: item.callId,
        content: item.output,
      });
    }
    // reasoning items are model-specific; never replayed across providers
  }
  if (messages[0]?.role !== 'user')
    messages.unshift({ role: 'user', content: [{ type: 'text', text: '(start)' }] });

  const params: ClaudeParams = { messages };
  if (systemParts.length) params.system = systemParts.join('\n\n');
  const tools = (req.tools ?? []) as AgAiToolSchema[];
  if (tools.length) {
    params.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
    const tc = req.toolChoice;
    params.tool_choice =
      tc === 'none'
        ? { type: 'none' }
        : tc === 'required'
          ? { type: 'any' }
          : tc && typeof tc === 'object'
            ? { type: 'tool', name: tc.name }
            : { type: 'auto' };
  } else if (req.responseFormat?.type === 'json') {
    params.output_config = {
      format: { type: 'json_schema', schema: req.responseFormat.schema as Record<string, unknown> },
    };
  }
  return params;
}

export interface ClaudeResult {
  id: string;
  model: string;
  stop_reason: string | null;
  content: (
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: string }
  )[];
  usage: { input_tokens: number; output_tokens: number };
}

export function fromClaudeResult(msg: ClaudeResult, createdAt = Date.now()): AgLlmResponse {
  const output: AgAiOutputItem[] = [];
  const text = msg.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (text) {
    output.push({
      id: `${msg.id}_text`,
      kind: 'output',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'text', text, annotations: [] }],
    });
  }
  for (const b of msg.content) {
    if (b.type !== 'tool_use') continue;
    const t = b as { id: string; name: string; input: unknown };
    output.push({
      id: `${msg.id}_${t.id}`,
      kind: 'output',
      type: 'function_call',
      callId: t.id,
      name: t.name,
      arguments: JSON.stringify(t.input ?? {}),
      status: 'completed',
    });
  }
  const incomplete = msg.stop_reason === 'max_tokens';
  return {
    id: msg.id,
    createdAt,
    model: msg.model,
    status: msg.stop_reason === 'refusal' ? 'failed' : incomplete ? 'incomplete' : 'completed',
    ...(incomplete ? { incompleteDetails: { reason: 'max_output_tokens' as const } } : {}),
    ...(msg.stop_reason === 'refusal'
      ? { error: { code: 'refusal', message: 'The model declined this request.' } }
      : {}),
    output,
    usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
  };
}
