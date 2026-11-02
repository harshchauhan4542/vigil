// Render Cron Job entry. Workflows have no native schedule, so cron starts the tasks.
//   node dist/cron.js            → detect_exceptions, then settle_check (every 15 min)
//   node dist/cron.js --nightly  → reseed_demo (fresh holds for judges)
import { loadWorkflowsEnv } from '@vigil/config';
import { createTaskRunner } from '@vigil/tasks';

const env = loadWorkflowsEnv();
const runner = createTaskRunner(env);
const nightly = process.argv.includes('--nightly');

const runs = nightly
  ? [await runner.start('reseed_demo', [])]
  : [await runner.start('detect_exceptions', []), await runner.start('settle_check', [])];
console.log(JSON.stringify({ event: 'cron.started', nightly, runs }));
