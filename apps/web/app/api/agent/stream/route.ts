// Interactive agent (claude-sonnet-5): streams the Claude loop as SSE. The agent can read and
// propose DRAFTs only; anything it proposes still goes through policy + human approval.
import { runAgent, type AgentEvent } from '@vigil/agent';
import { agentTokensSince } from '@vigil/db';
import { evaluateDraft } from '@vigil/gate';
import { json, rateLimited } from '../../../../lib/guards';
import { UUID_RE, serverFor } from '../../../../lib/request';

export const dynamic = 'force-dynamic';

function startOfUtcDay() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function POST(req: Request) {
  const limited = rateLimited('agent', 10, 60_000, req);
  if (limited) return limited;
  const s = await serverFor(req);
  if (!s.claude) {
    return json(
      { error: 'agent_unavailable', hint: 'set ANTHROPIC_API_KEY or switch to Replay mode' },
      503,
    );
  }
  if (
    s.mode === 'live' &&
    (await agentTokensSince(s.db, startOfUtcDay())) >= s.env.AI_DAILY_TOKEN_BUDGET
  ) {
    return json({ error: 'ai_budget_exhausted', hint: 'switch to Replay mode' }, 429);
  }
  const body = (await req.json().catch(() => ({}))) as { message?: string; exception_id?: string };
  const message = body.message?.trim().slice(0, 2000);
  if (!message) return json({ error: 'message required' }, 400);
  const exceptionId =
    body.exception_id && UUID_RE.test(body.exception_id) ? body.exception_id : null;

  const claude = s.claude;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent | { type: string; [k: string]: unknown }) =>
        controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      try {
        const result = await runAgent(
          {
            client: claude,
            db: s.db,
            http: s.http,
            model: s.env.VIGIL_MODEL_INTERACTIVE,
            mode: s.mode,
            effort: 'medium',
            policyLimits: {
              per_action_cap_usd: s.policy.perActionCapCents / 100,
              daily_cap_usd: s.policy.dailyCapCents / 100,
            },
            onEvent: send,
          },
          {
            exceptionId,
            messages: [
              {
                role: 'user',
                content: exceptionId
                  ? `(Context: exception ${exceptionId})\n\n${message}`
                  : message,
              },
            ],
          },
        );
        for (const id of result.proposalIds) {
          const policy = await evaluateDraft(s.gate, id);
          send({
            type: 'policy',
            proposalId: id,
            verdict: policy?.verdict ?? null,
            tier: policy?.tier ?? null,
          });
        }
        send({ type: 'done', runId: result.runId, stopReason: result.stopReason });
      } catch (error) {
        send({ type: 'error', message: (error as Error).message.split('\n')[0] });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' },
  });
}
