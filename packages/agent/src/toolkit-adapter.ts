// QUARANTINE: the only file allowed to import @paypal/agent-toolkit (ESLint enforces it).
// The toolkit pulls in zod 3, the OpenAI SDK and an older PayPal server SDK; none of it leaks
// past this file. Only read actions are enabled (never ALL_TOOLS_ENABLED). The toolkit makes
// its own HTTP calls (not through Vigil's replay transport), so it is used in live mode only.
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
import { z } from 'zod';
import { stripUnsupported, type AgentTool } from './tool.js';

/** Read-only toolkit actions. Note `shipment: { get }` (the README's `show` key is wrong). */
export const TOOLKIT_READ_ACTIONS = {
  orders: { get: true },
  transactions: { list: true },
  insights: { get: true },
  subscriptions: { show: true },
  invoices: { list: true, get: true, search: true },
  shipment: { get: true },
  disputes: { list: true, get: true },
} as const;

const ALLOWED_TOOL_NAMES = new Set([
  'get_order',
  'list_transactions',
  'get_merchant_insights',
  'show_subscription_details',
  'list_invoices',
  'get_invoice',
  'search_invoicing',
  'get_shipment_tracking',
  'list_disputes',
  'get_dispute',
]);

export function createToolkitTools(options: {
  clientId: string;
  secret: string;
  sandbox: boolean;
}): AgentTool[] {
  const toolkit = new PayPalAgentToolkit({
    clientId: options.clientId,
    clientSecret: options.secret,
    configuration: { actions: TOOLKIT_READ_ACTIONS, context: { sandbox: options.sandbox } },
  });
  return toolkit
    .getTools()
    .filter((t) => ALLOWED_TOOL_NAMES.has(t.function.name)) // belt and braces
    .map((t) => ({
      name: t.function.name,
      description: `[PayPal toolkit, read-only] ${t.function.description ?? ''}`.slice(0, 1024),
      schema: z.record(z.string(), z.unknown()),
      jsonSchema: stripUnsupported(
        t.function.parameters ?? { type: 'object', properties: {} },
      ) as Record<string, unknown>,
      strict: false, // toolkit schemas are not written for strict mode
      async run(input) {
        const result = await toolkit.handleToolCall({
          id: `call_${t.function.name}`,
          type: 'function',
          function: { name: t.function.name, arguments: JSON.stringify(input) },
        });
        return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      },
    }));
}
