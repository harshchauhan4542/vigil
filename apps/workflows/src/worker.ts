// Render Workflow service entry: registers every task. The SDK auto-starts the task server
// once tasks are registered (RENDER_SDK_SOCKET_PATH is set on Render).
import { task } from '@renderinc/sdk/workflows';
import { TASK_NAMES } from '@vigil/tasks';
import { bootstrap, type Bootstrapped } from './bootstrap.js';
import { buildHandlers } from './tasks/index.js';

let booted: Promise<Bootstrapped> | null = null;
const getCtx = async () => (await (booted ??= bootstrap())).ctx;
const handlers = buildHandlers(getCtx);

for (const name of TASK_NAMES) {
  task(
    {
      name,
      // Safe to retry: execute_proposal persists its PayPal-Request-Id before calling PayPal.
      retry: { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 1.5 },
      timeoutSeconds: name === 'reseed_demo' || name === 'triage_exception' ? 600 : 120,
    },
    (_renderCtx, ...args: unknown[]) => handlers[name](...args),
  );
}
