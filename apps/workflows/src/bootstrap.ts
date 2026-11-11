// Builds the WorkflowContext from the environment: database, PayPal client (through the
// record/replay transport), task runner and the Claude agent for triage.
import path from 'node:path';
import { createLlmClient, triageException } from '@vigil/agent';
import { loadWorkflowsEnv, type WorkflowsEnv } from '@vigil/config';
import { createDb, createDbFixtureStore, type DbHandle } from '@vigil/db';
import { createPayPalClient, createLogger } from '@vigil/paypal';
import { POLICY_V1, type PolicyConfig } from '@vigil/policy';
import { FileFixtureStore, LayeredFixtureStore, createReplayFetch } from '@vigil/replay';
import { InlineTaskRunner, RenderTaskRunner, type TaskRunner } from '@vigil/tasks';
import type { WorkflowContext } from './context.js';
import { buildHandlers } from './tasks/index.js';

export interface Bootstrapped {
  ctx: WorkflowContext;
  handle: DbHandle;
  runner: TaskRunner;
}

/** Caps from env (USD) override policy.v1.json so ops can tighten them without a deploy. */
export function policyFromEnv(
  env: Pick<WorkflowsEnv, 'POLICY_PER_ACTION_CAP_USD' | 'POLICY_DAILY_CAP_USD'>,
): PolicyConfig {
  return {
    ...POLICY_V1,
    perActionCapCents: env.POLICY_PER_ACTION_CAP_USD * 100,
    dailyCapCents: env.POLICY_DAILY_CAP_USD * 100,
  };
}

export async function bootstrap(
  env: WorkflowsEnv = loadWorkflowsEnv(),
  repoRoot = process.cwd(),
  options: { awaitTasks?: boolean } = {},
): Promise<Bootstrapped> {
  const logger = createLogger(env.LOG_LEVEL);
  const handle = await createDb({
    databaseUrl: env.DATABASE_URL,
    pgliteDir: path.resolve(repoRoot, env.PGLITE_DIR),
    // Bundled entry points can't locate the migrations relative to their own file.
    migrationsDir: path.resolve(repoRoot, 'packages/db/migrations'),
  });
  await handle.migrate();
  const store = new LayeredFixtureStore([
    createDbFixtureStore(handle.db),
    new FileFixtureStore(path.resolve(repoRoot, env.FIXTURES_DIR)),
  ]);

  const paypalFetch = createReplayFetch({
    mode: env.VIGIL_MODE,
    kind: 'paypal',
    store,
    record: env.RECORD,
    secrets: [env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET].filter((s): s is string => !!s),
  });
  const { http } = await createPayPalClient({
    clientId: env.PAYPAL_CLIENT_ID ?? 'replay-client',
    secret: env.PAYPAL_SECRET ?? 'replay-secret',
    baseUrl: env.PAYPAL_BASE_URL,
    redisUrl: env.REDIS_URL,
    fetch: paypalFetch,
    logger,
  });

  // Claude or an OpenAI-compatible provider (LLM_PROVIDER); null in Live without a key.
  const claude = createLlmClient(env, { mode: env.VIGIL_MODE, store, record: env.RECORD });

  const runner: TaskRunner =
    env.TASK_RUNNER === 'render'
      ? new RenderTaskRunner({ apiKey: env.RENDER_API_KEY ?? '' })
      : new InlineTaskRunner({
          awaitCompletion: options.awaitTasks ?? false,
          onError: (t, e) => logger.error({ task: t, err: String(e) }, 'task failed'),
        });

  const policy = policyFromEnv(env);
  const ctx: WorkflowContext = {
    db: handle.db,
    http,
    runner,
    approvalSecret: env.APPROVAL_HMAC_SECRET,
    executionEnabled: env.EXECUTION_ENABLED,
    policy,
    triage: claude
      ? async (exceptionId) =>
          triageException(
            {
              client: claude,
              db: handle.db,
              http,
              model: env.VIGIL_MODEL_BATCH,
              mode: env.VIGIL_MODE,
              effort: 'high',
              policyLimits: {
                per_action_cap_usd: policy.perActionCapCents / 100,
                daily_cap_usd: policy.dailyCapCents / 100,
                reauthorize_max_percent: policy.reauthorize.maxPercent,
                reauthorize_max_increase_usd: policy.reauthorize.maxIncreaseCents / 100,
              },
            },
            exceptionId,
          )
      : null,
    maxAttempts: 3,
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (event, fields = {}) => logger.info({ event, ...fields }, event),
  };
  if (runner instanceof InlineTaskRunner) runner.register(buildHandlers(async () => ctx));
  return { ctx, handle, runner };
}
