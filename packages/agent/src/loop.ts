// The Claude tool loop (manual, because Vigil needs its own transport for record/replay, a hard
// turn cap and a persisted trace). Streaming per turn; strict client tools; tool_choice auto
// (forced tool use is rejected on claude-opus-5-5); adaptive thinking; cached system prompt.
import type Anthropic from '@anthropic-ai/sdk';
import { sha256Hex, canonicalJson } from '@vigil/core';
import { finishAgentRun, startAgentRun, type Db } from '@vigil/db';
import type { PayPalHttp } from '@vigil/paypal';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { toClaudeTool, type AgentTool, type ToolContext } from './tool.js';
import { READ_TOOLS } from './tools-read.js';
import { PROPOSE_TOOLS } from './tools-propose.js';

export const DEFAULT_MAX_TURNS = 8;

export type AgentEvent =
  | { type: 'run_started'; runId: string; model: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; isError: boolean }
  | { type: 'proposal'; proposalId: string; action: string }
  | { type: 'run_finished'; runId: string; stopReason: string; turns: number };

export interface AgentOptions {
  client: Anthropic;
  db: Db;
  http: PayPalHttp;
  model: string;
  mode: 'live' | 'replay';
  policyLimits: Record<string, unknown>;
  maxTurns?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  /** Extra read tools (e.g. the quarantined PayPal toolkit, live mode only). */
  extraTools?: AgentTool[];
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  runId: string;
  stopReason: string;
  turns: number;
  proposalIds: string[];
  finalText: string;
  usage: { inputTokens: number; outputTokens: number };
}

export function allTools(extra: AgentTool[] = []): AgentTool[] {
  return [...READ_TOOLS, ...extra, ...PROPOSE_TOOLS];
}

/** Hash of everything frozen in the prompt (system + tool definitions). */
export function promptHash(tools: AgentTool[]): string {
  return sha256Hex(canonicalJson({ system: SYSTEM_PROMPT, tools: tools.map(toClaudeTool) }));
}

async function runTool(tool: AgentTool | undefined, input: unknown, ctx: ToolContext) {
  if (!tool) return { isError: true, content: 'Unknown tool.' };
  // strict tools guarantee the shape; Zod still enforces lengths, ranges and patterns.
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return {
      isError: true,
      content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    };
  }
  try {
    const out = await tool.run(parsed.data, ctx);
    const content = typeof out === 'string' ? out : JSON.stringify(out);
    const isError = !!out && typeof out === 'object' && 'error' in out;
    return { isError, content, out };
  } catch (error) {
    return { isError: true, content: `Tool failed: ${(error as Error).message}` };
  }
}

/**
 * Run the agent on a conversation. Returns when the model ends its turn, hits max_tokens,
 * refuses, or the turn cap is reached. Every run is saved to agent_runs with its full trace.
 */
export async function runAgent(
  options: AgentOptions,
  input: { exceptionId: string | null; messages: Anthropic.MessageParam[] },
): Promise<AgentRunResult> {
  const tools = allTools(options.extraTools);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const claudeTools = tools.map(toClaudeTool);
  const emit = options.onEvent ?? (() => {});
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;

  const run = await startAgentRun(options.db, {
    exceptionId: input.exceptionId,
    model: options.model,
    mode: options.mode,
    promptHash: promptHash(tools),
  });
  emit({ type: 'run_started', runId: run.id, model: options.model });

  const ctx: ToolContext = {
    db: options.db,
    http: options.http,
    exceptionId: input.exceptionId,
    agentRunId: run.id,
    policyLimits: options.policyLimits,
    seenIds: new Set(),
  };
  const messages: Anthropic.MessageParam[] = [...input.messages];
  const trace: unknown[] = [];
  const proposalIds: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = 'max_turns';
  let finalText = '';
  let turns = 0;

  try {
    while (turns < maxTurns) {
      turns++;
      const stream = options.client.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens ?? 16000,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: claudeTools,
        tool_choice: { type: 'auto' },
        thinking: { type: 'adaptive' },
        ...(options.effort ? { output_config: { effort: options.effort } } : {}),
        messages,
      });
      stream.on('text', (delta) => emit({ type: 'text', delta }));
      const message = await stream.finalMessage();
      usage.inputTokens +=
        message.usage.input_tokens +
        (message.usage.cache_read_input_tokens ?? 0) +
        (message.usage.cache_creation_input_tokens ?? 0);
      usage.outputTokens += message.usage.output_tokens;
      trace.push({
        turn: turns,
        stop_reason: message.stop_reason,
        content: message.content,
        usage: message.usage,
      });
      // Append the whole content (thinking blocks included, unchanged).
      messages.push({ role: 'assistant', content: message.content });
      finalText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (message.stop_reason === 'pause_turn') continue;
      if (message.stop_reason !== 'tool_use') {
        stopReason = message.stop_reason ?? 'unknown';
        break;
      }

      const calls = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      for (const c of calls) emit({ type: 'tool_call', id: c.id, name: c.name, input: c.input });
      // Parallel calls run concurrently; all results go back in ONE user message.
      const results = await Promise.all(
        calls.map(async (c) => {
          const r = await runTool(byName.get(c.name), c.input, ctx);
          emit({ type: 'tool_result', id: c.id, name: c.name, isError: r.isError });
          const pid = (r.out as { proposal_id?: string } | undefined)?.proposal_id;
          if (pid) {
            proposalIds.push(pid);
            emit({ type: 'proposal', proposalId: pid, action: c.name.replace(/^propose_/, '') });
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: c.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          };
        }),
      );
      trace.push({ turn: turns, tool_results: results });
      messages.push({ role: 'user', content: results });
    }
  } finally {
    await finishAgentRun(options.db, run.id, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      turns,
      trace: { stop_reason: stopReason, proposal_ids: proposalIds, turns: trace },
    });
  }
  emit({ type: 'run_finished', runId: run.id, stopReason, turns });
  return { runId: run.id, stopReason, turns, proposalIds, finalText, usage };
}

/** Batch triage of one exception (claude-opus-5-5 by default in the workflow). */
export function triageException(options: AgentOptions, exceptionId: string) {
  return runAgent(options, {
    exceptionId,
    messages: [
      {
        role: 'user',
        content: `Triage exception ${exceptionId}. Start with get_exception, read the PayPal objects in its evidence, then make exactly one proposal (or propose_dismiss).`,
      },
    ],
  });
}
