// Proves the trust-boundary lint rules: forbidden imports must fail lint, allowed ones must pass.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: repoRoot });

async function restrictedImportErrors(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
}

const forbidden = [
  ['agent imports paypal actions', 'packages/agent/src/x.ts', "import '@vigil/paypal/actions';"],
  [
    'agent deep-imports actions by relative path',
    'packages/agent/src/x.ts',
    "import '../../paypal/src/actions.js';",
  ],
  ['agent imports policy', 'packages/agent/src/x.ts', "import '@vigil/policy';"],
  ['web imports paypal actions', 'apps/web/app/api/x/route.ts', "import '@vigil/paypal/actions';"],
  ['policy imports the LLM SDK', 'packages/policy/src/x.ts', "import '@anthropic-ai/sdk';"],
  ['policy imports paypal reads', 'packages/policy/src/x.ts', "import '@vigil/paypal';"],
  ['policy imports the agent', 'packages/policy/src/x.ts', "import '@vigil/agent';"],
  ['core imports the db', 'packages/core/src/x.ts', "import '@vigil/db';"],
  ['detectors import fs', 'packages/detectors/src/x.ts', "import 'node:fs';"],
  ['detectors import the LLM SDK', 'packages/detectors/src/x.ts', "import '@anthropic-ai/sdk';"],
  ['paypal imports the agent', 'packages/paypal/src/x.ts', "import '@vigil/agent';"],
  [
    'execute task imports the LLM SDK',
    'apps/workflows/src/tasks/execute-proposal.ts',
    "import '@anthropic-ai/sdk';",
  ],
  ['db imports paypal actions', 'packages/db/src/x.ts', "import '@vigil/paypal/actions';"],
  ['scripts import paypal actions', 'scripts/src/seed.ts', "import '@vigil/paypal/actions';"],
  [
    'agent imports sandbox setup',
    'packages/agent/src/x.ts',
    "import '@vigil/paypal/sandbox-setup';",
  ],
  ['web imports sandbox setup', 'apps/web/lib/x.ts', "import '@vigil/paypal/sandbox-setup';"],
];

const allowed = [
  [
    'workflows import paypal actions',
    'apps/workflows/src/tasks/execute-proposal.ts',
    "import '@vigil/paypal/actions';",
  ],
  ['agent imports paypal reads', 'packages/agent/src/x.ts', "import '@vigil/paypal/reads';"],
  ['policy imports core', 'packages/policy/src/x.ts', "import '@vigil/core';"],
  ['detectors import core', 'packages/detectors/src/x.ts', "import '@vigil/core';"],
  ['paypal imports its own actions', 'packages/paypal/src/x.ts', "import './actions.js';"],
  ['scripts import sandbox setup', 'scripts/src/seed.ts', "import '@vigil/paypal/sandbox-setup';"],
  [
    'workflows reseed imports sandbox setup',
    'apps/workflows/src/tasks/reseed-demo.ts',
    "import '@vigil/paypal/sandbox-setup';",
  ],
];

describe('trust-boundary import rules', () => {
  it.each(forbidden)('rejects: %s', async (_name, file, code) => {
    expect(await restrictedImportErrors(file, code)).not.toHaveLength(0);
  });

  it.each(allowed)('allows: %s', async (_name, file, code) => {
    expect(await restrictedImportErrors(file, code)).toHaveLength(0);
  });
});
