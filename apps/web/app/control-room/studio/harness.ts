// AG Studio AI harness: Studio's built-in agents run on Claude (via /api/ai), and the lead agent
// can delegate money questions to the Vigil Ops agent; visual requests stay with the built-in
// dashboard agents (charts, widgets).
import {
  createAiHarness,
  directLlmRunner,
  type AgAiHarnessSetup,
  type AgAnyAiAgentRunner,
} from 'ag-studio';
import { createAnthropicAdapter } from './anthropic-adapter';
import { VIGIL_OPS_ID, vigilOpsAgent } from './vigil-ops-agent';

export const vigilHarness: AgAiHarnessSetup = (params) =>
  createAiHarness(params.api, ({ tools, builtIn }) => {
    const adapter = createAnthropicAdapter();
    const builtInRunners: AgAnyAiAgentRunner[] = Object.values(builtIn).map((def) =>
      directLlmRunner({
        ...def,
        adapter,
        ...(def.id === 'lead'
          ? {
              tools: (ctx, p) => [...(def.tools?.(ctx, p) ?? []), tools.delegateTo([VIGIL_OPS_ID])],
              instructions: (ctx, p) =>
                `${def.instructions?.(ctx, p) ?? ''}\n\nFor anything about PayPal money exceptions, holds, refunds, renewals, shipments or proposals, delegate to the "${VIGIL_OPS_ID}" agent. For charts and widgets, use the dashboard agents.`,
            }
          : {}),
      }),
    );
    return {
      agents: [...builtInRunners, vigilOpsAgent],
      primary: 'lead',
      promptStarters: [
        {
          label: 'What needs my attention?',
          prompt: 'Which money exceptions need my attention first, and what do you propose?',
        },
        { label: 'Chart money at risk', prompt: 'Chart money at risk by exception type.' },
      ],
    };
  });
