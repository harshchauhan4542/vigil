// Tool definitions: one Zod schema per tool gives runtime validation AND the Claude tool schema.
import type Anthropic from '@anthropic-ai/sdk';
import type { Db } from '@vigil/db';
import type { PayPalHttp } from '@vigil/paypal';
import { z } from 'zod';

export interface ToolContext {
  db: Db;
  http: PayPalHttp;
  exceptionId: string | null;
  agentRunId: string;
  /** Policy limits as plain data (the agent may not import the policy package). */
  policyLimits: Record<string, unknown>;
  /** Ids the agent has seen in tool results this run (for the model's own grounding). */
  seenIds: Set<string>;
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Toolkit tools bring raw JSON Schema and can't use strict mode. */
  strict?: boolean;
  jsonSchema?: Record<string, unknown>;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

export function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

/** JSON-Schema keywords strict tool use does not support; Zod still enforces them client-side. */
const UNSUPPORTED = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
]);

export function stripUnsupported(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.has(k)) continue;
    out[k] =
      k === 'properties' && v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([p, s]) => [p, stripUnsupported(s)]))
        : stripUnsupported(v);
  }
  return out;
}

export function toClaudeTool(tool: AgentTool): Anthropic.Tool {
  const schema = (tool.jsonSchema ??
    stripUnsupported(z.toJSONSchema(tool.schema, { io: 'input' }))) as Anthropic.Tool.InputSchema;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema,
    ...(tool.strict === false ? {} : { strict: true }),
  };
}
