// Shared ESLint flat config for Vigil, including the trust-boundary import rules.
// See BUILD_BLUEPRINT.md §4. Do not weaken these rules: CI proves them.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** The only module that moves money. Reachable from apps/workflows (and paypal itself) only. */
const PAYPAL_ACTIONS = {
  group: ['@vigil/paypal/actions', '@vigil/paypal/src/actions*', '**/paypal/src/actions*'],
  message:
    'Trust boundary: only apps/workflows may import the money-moving PayPal actions (packages/paypal/src/actions.ts).',
};

const LLM_SDK = {
  group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*', '@vigil/agent', '@vigil/agent/*'],
  message: 'Trust boundary: this module must never import the LLM SDK or the agent.',
};

const POLICY_MINT = {
  group: ['@vigil/policy', '@vigil/policy/*'],
  message:
    'Trust boundary: the agent may not import the policy engine (approval-token minting lives there).',
};

const IO_MODULES = {
  group: [
    '@vigil/db',
    '@vigil/db/*',
    '@vigil/paypal',
    '@vigil/paypal/*',
    '@vigil/replay',
    '@vigil/replay/*',
    '@vigil/tasks',
    '@vigil/tasks/*',
    '@vigil/config',
    '@vigil/config/*',
    'pg',
    'ioredis',
    '@electric-sql/pglite',
    'drizzle-orm',
    'drizzle-orm/*',
    'node:fs',
    'node:fs/*',
    'node:net',
    'node:http',
    'node:https',
    'node:child_process',
    'fs',
    'fs/*',
    'http',
    'https',
    'child_process',
  ],
  message: 'Trust boundary: this package is pure. No I/O, database, network or config imports.',
};

const PAYPAL_ANY = {
  group: ['@vigil/paypal', '@vigil/paypal/*'],
  message:
    'Trust boundary: policy takes fresh PayPal state as an input; it never fetches it itself.',
};

/** Build a no-restricted-imports rule entry from pattern groups. */
const restrict = (...patterns) => ['error', { patterns }];

/** Trust-boundary rule set, one entry per file scope. Later entries override earlier ones. */
export const boundaryRules = [
  // Default for every file: nobody imports the money-moving actions.
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    rules: { 'no-restricted-imports': restrict(PAYPAL_ACTIONS) },
  },
  // Pure packages: core and detectors.
  {
    files: ['packages/core/**', 'packages/detectors/**'],
    rules: { 'no-restricted-imports': restrict(PAYPAL_ACTIONS, LLM_SDK, POLICY_MINT, IO_MODULES) },
  },
  // Policy: pure and deterministic. May import core only.
  {
    files: ['packages/policy/**'],
    rules: { 'no-restricted-imports': restrict(PAYPAL_ACTIONS, LLM_SDK, IO_MODULES, PAYPAL_ANY) },
  },
  // Agent (Tier 1): proposes only. No actions, no policy minting.
  {
    files: ['packages/agent/**'],
    rules: { 'no-restricted-imports': restrict(PAYPAL_ACTIONS, POLICY_MINT) },
  },
  // PayPal package: holds credentials, never talks to the agent or LLM.
  // Inside the package, relative imports of ./actions are allowed (index.ts must not re-export it).
  {
    files: ['packages/paypal/**'],
    rules: { 'no-restricted-imports': restrict(LLM_SDK) },
  },
  // Workflows (Tier 3) may import actions.
  {
    files: ['apps/workflows/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // ...but the execute task must never touch the LLM.
  {
    files: ['apps/workflows/src/tasks/execute-proposal.ts'],
    rules: { 'no-restricted-imports': restrict(LLM_SDK) },
  },
  // Seed / ops scripts run outside the app and may create sandbox objects through actions.
  {
    files: ['scripts/**'],
    rules: { 'no-restricted-imports': restrict(LLM_SDK) },
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  ...boundaryRules,
  prettier,
);
