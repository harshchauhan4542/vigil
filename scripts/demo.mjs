// pnpm demo — run Vigil in Replay mode from a fresh clone: no keys, no Docker, no network.
// Builds the web app, then serves http://localhost:3000/control-room.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const env = {
  ...process.env,
  VIGIL_MODE: 'replay',
  NEXT_TELEMETRY_DISABLED: '1',
  APPROVAL_HMAC_SECRET: process.env.APPROVAL_HMAC_SECRET || randomBytes(32).toString('hex'),
  SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
};
const run = (args) => {
  const r = spawnSync('pnpm', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
console.log('Building Vigil (Replay mode, zero keys)…');
run(['--filter', '@vigil/web', 'exec', 'next', 'build', '--webpack']);
const port = process.env.PORT || '3000';
console.log(`Open http://localhost:${port}/control-room`);
run(['--filter', '@vigil/web', 'exec', 'next', 'start', '-p', port]);
