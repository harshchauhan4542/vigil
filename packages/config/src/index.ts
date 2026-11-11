// Zod-validated environment loaders, one per app. They fail fast with a message naming
// every missing or invalid variable (never its value, which may be a secret).
import { z } from 'zod';

export class ConfigError extends Error {
  override name = 'ConfigError';
  constructor(
    readonly app: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid environment for ${app}:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
}

type Env = Record<string, string | undefined>;

/** Treat empty strings like unset so `FOO=` in .env means "not provided". */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const requiredString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1));
const bool = (fallback: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? fallback : v),
    z.union([
      z.boolean(),
      z.enum(['true', 'false', '1', '0']).transform((s) => s === 'true' || s === '1'),
    ]),
  );
const positiveInt = (fallback: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? fallback : v),
    z.coerce.number().int().positive(),
  );
const url = (fallback?: string) =>
  z.preprocess((v) => (v === undefined || v === '' ? fallback : v), z.url());

const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com';

export const paypalSchema = z.object({
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_SECRET: optionalString,
  PAYPAL_WEBHOOK_ID: optionalString,
  PAYPAL_BASE_URL: url(PAYPAL_SANDBOX),
  ALLOW_SIMULATED_WEBHOOKS: bool(false),
});

export const infraSchema = z.object({
  DATABASE_URL: optionalString,
  PGLITE_DIR: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('.data/pglite')),
  REDIS_URL: optionalString,
  TASK_RUNNER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['inline', 'render']).default('inline'),
  ),
  RENDER_API_KEY: optionalString,
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
});

export const vigilSchema = z.object({
  VIGIL_MODE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['live', 'replay']).default('replay'),
  ),
  EXECUTION_ENABLED: bool(true),
  /** In live mode, record every PayPal and Claude response for replay. */
  RECORD: bool(false),
  FIXTURES_DIR: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().default('fixtures/recordings'),
  ),
  POLICY_PER_ACTION_CAP_USD: positiveInt(500),
  POLICY_DAILY_CAP_USD: positiveInt(2000),
});

export const aiSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  VIGIL_MODEL_INTERACTIVE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().default('claude-sonnet-5'),
  ),
  VIGIL_MODEL_BATCH: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().default('claude-opus-5-5'),
  ),
  AI_DAILY_TOKEN_BUDGET: positiveInt(2_000_000),
});

export const secretsSchema = z.object({
  APPROVAL_HMAC_SECRET: optionalString,
  SESSION_SECRET: optionalString,
});

export const seedSchema = z.object({
  PAYPAL_SANDBOX_BUSINESS_EMAIL: optionalString,
  PAYPAL_SANDBOX_PERSONAL_EMAIL: optionalString,
  PAYPAL_SANDBOX_PERSONAL_PASSWORD: optionalString,
  // Sandbox test card for single-step orders (no buyer redirect). Empty = buyer-approval links.
  SEED_CARD_NUMBER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().default('4111111111111111'),
  ),
  SEED_CARD_EXPIRY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .default('2030-12'),
  ),
});

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return issue.code === 'invalid_type' && issue.input === undefined
      ? `${key} is missing`
      : `${key}: ${issue.message}`;
  });
}

function load<S extends z.ZodType>(app: string, schema: S, env: Env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) throw new ConfigError(app, formatIssues(result.error));
  return result.data;
}

/** Live mode needs real credentials; replay mode runs with zero keys. */
function requireInLive(
  keys: readonly string[],
): (value: Record<string, unknown>, ctx: z.RefinementCtx) => void {
  return (value, ctx) => {
    if (value.VIGIL_MODE !== 'live') return;
    for (const key of keys) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is missing (required when VIGIL_MODE=live)`,
        });
      }
    }
  };
}

const LONG_SECRET = (key: string) => (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
  const v = value[key];
  if (typeof v === 'string' && v.length < 32) {
    ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be at least 32 characters` });
  }
};

export const webEnvSchema = paypalSchema
  .extend(infraSchema.shape)
  .extend(vigilSchema.shape)
  .extend(aiSchema.shape)
  .extend(secretsSchema.shape)
  .extend({ AG_STUDIO: optionalString })
  .extend(seedSchema.shape)
  .superRefine(requireInLive(['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY']))
  .superRefine((v, ctx) => {
    for (const key of ['APPROVAL_HMAC_SECRET', 'SESSION_SECRET']) {
      if (v[key as keyof typeof v] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is missing` });
      }
    }
  })
  .superRefine(LONG_SECRET('APPROVAL_HMAC_SECRET'))
  .superRefine(LONG_SECRET('SESSION_SECRET'));
export type WebEnv = z.infer<typeof webEnvSchema>;

export const workflowsEnvSchema = paypalSchema
  .extend(infraSchema.shape)
  .extend(vigilSchema.shape)
  .extend(aiSchema.shape)
  .extend({ APPROVAL_HMAC_SECRET: requiredString })
  .superRefine(requireInLive(['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET']))
  .superRefine(LONG_SECRET('APPROVAL_HMAC_SECRET'));
export type WorkflowsEnv = z.infer<typeof workflowsEnvSchema>;

/** PayPal access for scripts (smoke test, seeder): credentials always required. */
export const paypalLiveEnvSchema = paypalSchema.extend({
  PAYPAL_CLIENT_ID: requiredString,
  PAYPAL_SECRET: requiredString,
});
export type PayPalLiveEnv = z.infer<typeof paypalLiveEnvSchema>;

export const seedEnvSchema = paypalLiveEnvSchema.extend(infraSchema.shape).extend(seedSchema.shape);
export type SeedEnv = z.infer<typeof seedEnvSchema>;

export const dbEnvSchema = infraSchema;
export type DbEnv = z.infer<typeof dbEnvSchema>;

export const loadWebEnv = (env: Env = process.env): WebEnv => load('web', webEnvSchema, env);
export const loadWorkflowsEnv = (env: Env = process.env): WorkflowsEnv =>
  load('workflows', workflowsEnvSchema, env);
export const loadPayPalLiveEnv = (env: Env = process.env): PayPalLiveEnv =>
  load('paypal', paypalLiveEnvSchema, env);
export const loadSeedEnv = (env: Env = process.env): SeedEnv => load('seed', seedEnvSchema, env);
export const loadDbEnv = (env: Env = process.env): DbEnv => load('db', dbEnvSchema, env);
