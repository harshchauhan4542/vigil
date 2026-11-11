// Claude behind AG Studio's built-in agents (Plan A, spike S3). The browser sends an
// AgLlmRequest; we translate it to the Messages API and return an AgLlmResponse. These agents
// only touch the dashboard (widgets, queries); nothing here can reach money.
import { agentTokensSince } from '@vigil/db';
import type { AgLlmRequest } from 'ag-studio';
import { json, rateLimited } from '../../../lib/guards';
import { serverFor } from '../../../lib/request';
import { fromClaudeResult, toClaudeParams, type ClaudeResult } from '../../../lib/studio-ai';

export const dynamic = 'force-dynamic';

function startOfUtcDay() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function POST(req: Request) {
  const limited = rateLimited('studio-ai', 30, 60_000, req);
  if (limited) return limited;
  const s = await serverFor(req);
  if (!s.claude) return json({ error: 'agent_unavailable' }, 503);
  if (
    s.mode === 'live' &&
    (await agentTokensSince(s.db, startOfUtcDay())) >= s.env.AI_DAILY_TOKEN_BUDGET
  ) {
    return json({ error: 'ai_budget_exhausted', hint: 'switch to Replay mode' }, 429);
  }
  const body = (await req.json().catch(() => null)) as AgLlmRequest | null;
  if (!body || !Array.isArray(body.input)) return json({ error: 'invalid request' }, 400);

  const params = toClaudeParams(body);
  const stream = s.claude.messages.stream({
    model: s.env.VIGIL_MODEL_INTERACTIVE,
    max_tokens: 16000,
    // Forced tool use (Studio's 'required' / named tool) is rejected while thinking is on.
    thinking:
      params.tool_choice &&
      (params.tool_choice.type === 'any' || params.tool_choice.type === 'tool')
        ? { type: 'disabled' }
        : { type: 'adaptive' },
    output_config: { effort: 'low', ...(params.output_config ?? {}) },
    ...(params.system ? { system: params.system } : {}),
    messages: params.messages,
    ...(params.tools ? { tools: params.tools, tool_choice: params.tool_choice } : {}),
  } as unknown as Parameters<typeof s.claude.messages.stream>[0]);
  const message = (await stream.finalMessage()) as unknown as ClaudeResult;
  return json(fromClaudeResult(message));
}
