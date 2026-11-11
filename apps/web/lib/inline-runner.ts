// The ONE web-app file allowed to load @vigil/workflows (lint-enforced): an in-process task
// runner for local development (TASK_RUNNER=inline) and for Replay mode, where every PayPal call
// is served from recordings. On Render in Live mode the web app uses RenderTaskRunner instead and
// never loads the execution code.
import { triageException } from '@vigil/agent';
import type { WebEnv } from '@vigil/config';
import type { VigilMode } from '@vigil/core';
import { InlineTaskRunner, type TaskRunner } from '@vigil/tasks';
import { buildHandlers, prepareReplayWorld, type WorkflowContext } from '@vigil/workflows';
import type { Core } from './server';

export function createInlineRunner(
  core: Core,
  env: WebEnv,
  mode: VigilMode,
  awaitCompletion = false,
) {
  const runner = new InlineTaskRunner({
    awaitCompletion,
    onError: (task, error) =>
      console.error(JSON.stringify({ event: 'task.failed', task, error: String(error) })),
  });
  const claude = core.claude;
  const ctx: WorkflowContext = {
    db: core.db,
    http: core.http,
    runner,
    approvalSecret: env.APPROVAL_HMAC_SECRET!,
    executionEnabled: env.EXECUTION_ENABLED,
    policy: core.policy,
    triage: claude
      ? (exceptionId) =>
          triageException(
            {
              client: claude,
              db: core.db,
              http: core.http,
              model: env.VIGIL_MODEL_BATCH,
              mode,
              effort: 'high',
              policyLimits: {
                per_action_cap_usd: core.policy.perActionCapCents / 100,
                daily_cap_usd: core.policy.dailyCapCents / 100,
              },
            },
            exceptionId,
          )
      : null,
    maxAttempts: 3,
    now: core.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (event, fields = {}) => console.log(JSON.stringify({ event, ...fields })),
  };
  return runner.register(buildHandlers(async () => ctx));
}

/** Replay: load the demo seed into the isolated database and run the first sweep. */
export async function prepareReplay(core: Core, runner: TaskRunner, repoRoot: string) {
  return prepareReplayWorld(core.db, runner, repoRoot);
}
