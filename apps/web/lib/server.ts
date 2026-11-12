// Server-side wiring for the web app: database, PayPal client and Claude client (both through
// the record/replay transport), the task runner and the gate. One instance per mode, per process.
// Never imports the money-moving actions; with TASK_RUNNER=inline (local dev) or in Replay mode
// the in-process runner comes from ./inline-runner.ts, the single file allowed to load workflows.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createLlmClient } from '@vigil/agent';
import { ConfigError, loadWebEnv, type WebEnv } from '@vigil/config';
import type { VigilMode } from '@vigil/core';
import {
  createDb,
  createDbFixtureStore,
  deleteSetting,
  getSetting,
  putSetting,
  type Db,
} from '@vigil/db';
import type { GateDeps, ReceiveDeps } from '@vigil/gate';
import { CertCache, createLogger, createPayPalClient, type PayPalHttp } from '@vigil/paypal';
import { POLICY_V1, type PolicyConfig } from '@vigil/policy';
import {
  FileFixtureStore,
  LayeredFixtureStore,
  createReplayFetch,
  type FixtureStore,
} from '@vigil/replay';
import { RenderTaskRunner, type TaskRunner } from '@vigil/tasks';

type ClaudeClient = NonNullable<ReturnType<typeof createLlmClient>>;

export interface Server {
  mode: VigilMode;
  /** Set when Live was requested but couldn't run, so Replay is being served instead. */
  fallback?: { from: 'live'; reason: string };
  env: WebEnv;
  db: Db;
  http: PayPalHttp;
  claude: ClaudeClient | null;
  runner: TaskRunner;
  policy: PolicyConfig;
  gate: GateDeps;
  webhooks: ReceiveDeps;
  store: FixtureStore;
  /** Releases the database (PGlite allows one open instance per directory). */
  close?: () => Promise<void>;
}

export interface Core {
  /** Frozen demo clock in Replay; the real clock in Live. */
  now: () => Date;
  db: Db;
  http: PayPalHttp;
  claude: ClaudeClient | null;
  store: FixtureStore;
  policy: PolicyConfig;
  close?: () => Promise<void>;
}

const g = globalThis as unknown as {
  __vigilServers?: Map<VigilMode, Promise<Server>>;
  __vigilTestServer?: Server | null;
};

/** Tests inject a fully built server. */
export function setServerForTests(server: Server | null) {
  g.__vigilTestServer = server;
}

export function repoRoot(): string {
  // next dev/start run with cwd = apps/web
  return path.resolve(
    process.cwd(),
    process.cwd().endsWith(path.join('apps', 'web')) ? '../..' : '.',
  );
}

export function policyFromEnv(env: WebEnv): PolicyConfig {
  return {
    ...POLICY_V1,
    perActionCapCents: env.POLICY_PER_ACTION_CAP_USD * 100,
    dailyCapCents: env.POLICY_DAILY_CAP_USD * 100,
  };
}

export interface ReplayInfo {
  recordedAt: string;
  /** true = generated against Vigil's PayPal simulator, not the real sandbox. */
  synthetic: boolean;
}

/** fixtures/demo/manifest.json: the clock the recordings were made at, and their origin. */
export function readReplayInfo(root = repoRoot()): ReplayInfo | null {
  try {
    const m = JSON.parse(
      readFileSync(path.join(root, 'fixtures', 'demo', 'manifest.json'), 'utf8'),
    ) as Partial<ReplayInfo>;
    return m.recordedAt ? { recordedAt: m.recordedAt, synthetic: m.synthetic !== false } : null;
  } catch {
    return null;
  }
}

function readDemoNow(root: string): Date | null {
  const info = readReplayInfo(root);
  return info ? new Date(info.recordedAt) : null;
}

async function buildCore(env: WebEnv, mode: VigilMode): Promise<Core> {
  const root = repoRoot();
  // Replay is an isolated world: its own in-memory database, never the Live one.
  const handle = await createDb({
    databaseUrl: mode === 'live' ? env.DATABASE_URL : undefined,
    pgliteDir: mode === 'live' ? path.resolve(root, env.PGLITE_DIR) : 'memory://',
    migrationsDir: path.resolve(root, 'packages/db/migrations'),
  });
  await handle.migrate();
  const store = new LayeredFixtureStore([
    createDbFixtureStore(handle.db),
    new FileFixtureStore(path.resolve(root, env.FIXTURES_DIR)),
  ]);
  const { http } = await createPayPalClient({
    clientId: env.PAYPAL_CLIENT_ID ?? 'replay-client',
    secret: env.PAYPAL_SECRET ?? 'replay-secret',
    baseUrl: env.PAYPAL_BASE_URL,
    redisUrl: env.REDIS_URL,
    fetch: createReplayFetch({
      mode,
      kind: 'paypal',
      store,
      record: mode === 'live' && env.RECORD,
      secrets: [env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET].filter((s): s is string => !!s),
    }),
    logger: createLogger(env.LOG_LEVEL),
  });
  // Claude or an OpenAI-compatible provider (LLM_PROVIDER); null in Live without a key.
  const claude = createLlmClient(env, { mode, store, record: mode === 'live' && env.RECORD });
  const demoNow = mode === 'replay' ? readDemoNow(root) : null;
  return {
    db: handle.db,
    http,
    claude,
    store,
    policy: policyFromEnv(env),
    now: () => demoNow ?? new Date(),
    close: () => handle.close(),
  };
}

/** Env validated for a specific mode (Live requires keys; Replay doesn't). */
export function envFor(mode: VigilMode, overrides: Record<string, string> = {}): WebEnv {
  if (mode === 'live') return loadWebEnv({ ...process.env, ...overrides, VIGIL_MODE: mode });
  // Replay serves the recorded world, which was recorded with the default (Claude) provider
  // and model names. The model is part of each recording's key, so a Live model choice in
  // .env (e.g. Groq's gpt-oss-120b) must not leak into Replay.
  return loadWebEnv({
    ...process.env,
    VIGIL_MODE: mode,
    LLM_PROVIDER: undefined,
    VIGIL_MODEL_INTERACTIVE: undefined,
    VIGIL_MODEL_BATCH: undefined,
  });
}

/** The default mode from the environment, without validating the rest. */
export function defaultMode(): VigilMode {
  return process.env.VIGIL_MODE === 'live' ? 'live' : 'replay';
}

async function build(mode: VigilMode): Promise<Server> {
  // PayPal keys saved on the Settings page take precedence over the environment.
  const env = envFor(mode, mode === 'live' ? await savedPayPalEnv() : {});
  const core = await buildCore(env, mode);
  // Replay never reaches the network, so it always runs in-process.
  const runner: TaskRunner =
    env.TASK_RUNNER === 'render' && mode === 'live'
      ? new RenderTaskRunner({ apiKey: env.RENDER_API_KEY ?? '' })
      : (await import('./inline-runner')).createInlineRunner(core, env, mode, mode === 'replay');
  if (mode === 'replay') {
    await (await import('./inline-runner')).prepareReplay(core, runner, repoRoot());
  }
  return assemble(env, mode, core, runner);
}

export function assemble(env: WebEnv, mode: VigilMode, core: Core, runner: TaskRunner): Server {
  return {
    mode,
    env,
    ...core,
    runner,
    gate: {
      db: core.db,
      http: core.http,
      runner,
      approvalSecret: env.APPROVAL_HMAC_SECRET!,
      executionEnabled: env.EXECUTION_ENABLED,
      policy: core.policy,
      now: core.now,
    },
    webhooks: {
      db: core.db,
      http: core.http,
      runner,
      certs: new CertCache(),
      webhookId: env.PAYPAL_WEBHOOK_ID,
      allowSimulated: env.ALLOW_SIMULATED_WEBHOOKS,
    },
  };
}

const FALLBACK_RETRY_MS = 5 * 60_000;

/** Live needs real keys; anything missing or broken falls back to Replay, said on screen. */
async function buildLiveOrFallback(): Promise<Server> {
  try {
    return await build('live');
  } catch (error) {
    const replay = await build('replay');
    const reason =
      error instanceof ConfigError
        ? error.issues.join('; ').slice(0, 200)
        : (error as Error).message.split(String.fromCharCode(10))[0]!.slice(0, 200);
    console.error(JSON.stringify({ event: 'live.fallback_to_replay', reason }));
    return { ...replay, fallback: { from: 'live', reason } };
  }
}

export async function getServer(mode?: VigilMode): Promise<Server> {
  if (g.__vigilTestServer) return g.__vigilTestServer;
  const m = mode ?? defaultMode();
  g.__vigilServers ??= new Map();
  let s = g.__vigilServers.get(m);
  if (!s) {
    s = m === 'live' ? buildLiveOrFallback() : build(m);
    s.catch(() => g.__vigilServers?.delete(m));
    g.__vigilServers.set(m, s);
    // A fallback is temporary: try Live again later.
    void s.then((srv) => {
      if (srv.fallback) setTimeout(() => g.__vigilServers?.delete(m), FALLBACK_RETRY_MS).unref?.();
    });
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// PayPal keys saved from the Settings page (encrypted in `app_settings`, Live database only).

export const PAYPAL_SETTING = 'paypal';

export interface SavedPayPal {
  clientId: string;
  secret: string;
  webhookId?: string;
  savedAt: string;
}

/** Run `fn` against the Live database: the running Live server's, or a short-lived handle. */
export async function withLiveDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const cached = g.__vigilServers?.get('live');
  if (cached) {
    const srv = await cached.catch(() => null);
    if (srv && !srv.fallback) return fn(srv.db);
  }
  const handle = await createDb({
    databaseUrl: process.env.DATABASE_URL,
    pgliteDir: path.resolve(repoRoot(), process.env.PGLITE_DIR || '.data/pglite'),
    migrationsDir: path.resolve(repoRoot(), 'packages/db/migrations'),
  });
  try {
    await handle.migrate();
    return await fn(handle.db);
  } finally {
    await handle.close();
  }
}

export async function readSavedPayPal(): Promise<SavedPayPal | null> {
  const { unseal } = await import('./secret-box');
  const sealed = await withLiveDb((db) => getSetting(db, PAYPAL_SETTING));
  return sealed ? unseal<SavedPayPal>(sealed, process.env.SESSION_SECRET) : null;
}

async function savedPayPalEnv(): Promise<Record<string, string>> {
  try {
    const saved = await readSavedPayPal();
    if (!saved) return {};
    return {
      PAYPAL_CLIENT_ID: saved.clientId,
      PAYPAL_SECRET: saved.secret,
      ...(saved.webhookId ? { PAYPAL_WEBHOOK_ID: saved.webhookId } : {}),
    };
  } catch {
    return {}; // no database yet, or unreadable: fall back to the environment
  }
}

/** Stop the Live server so the next request rebuilds it (e.g. after new keys were saved). */
export async function restartLive(): Promise<void> {
  const cached = g.__vigilServers?.get('live');
  g.__vigilServers?.delete('live');
  if (!cached) return;
  const srv = await cached.catch(() => null);
  await srv?.close?.().catch(() => undefined);
}

export async function savePayPal(value: SavedPayPal): Promise<void> {
  const { seal } = await import('./secret-box');
  const sealed = seal(value, process.env.SESSION_SECRET);
  await restartLive();
  await withLiveDb((db) => putSetting(db, PAYPAL_SETTING, sealed));
}

export async function clearPayPal(): Promise<void> {
  await restartLive();
  await withLiveDb((db) => deleteSetting(db, PAYPAL_SETTING));
}
