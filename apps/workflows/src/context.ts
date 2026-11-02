// Everything a workflow task needs. Built once per process (see bootstrap.ts) or by tests.
// Deliberately free of LLM types: triage is injected as a plain function, so modules like
// execute-proposal.ts never depend on the agent.
import type { Db } from '@vigil/db';
import type { GateDeps } from '@vigil/gate';
import type { PayPalHttp } from '@vigil/paypal';
import type { PolicyConfig } from '@vigil/policy';
import type { TaskRunner } from '@vigil/tasks';

export interface TriageOutcome {
  runId: string;
  proposalIds: string[];
  stopReason: string;
}

export interface WorkflowContext {
  db: Db;
  http: PayPalHttp;
  runner: TaskRunner;
  approvalSecret: string;
  executionEnabled: boolean;
  policy: PolicyConfig;
  /** Runs the Claude agent on one exception; null when no agent is configured. */
  triage: ((exceptionId: string) => Promise<TriageOutcome>) | null;
  /** Card for single-step seeding (reseed task). */
  seedCard?: { number: string; expiry: string; name: string } | undefined;
  /** In-task attempts for retryable PayPal failures (same PayPal-Request-Id). */
  maxAttempts: number;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

export function gateDeps(ctx: WorkflowContext): GateDeps {
  return {
    db: ctx.db,
    http: ctx.http,
    runner: ctx.runner,
    approvalSecret: ctx.approvalSecret,
    executionEnabled: ctx.executionEnabled,
    policy: ctx.policy,
    now: ctx.now,
  };
}

export const SYSTEM_ACTOR = { type: 'system', id: 'workflows' } as const;
