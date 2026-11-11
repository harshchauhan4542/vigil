import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

// Load vigil/.env for local runs. Never overrides values already set (CI, Render, Playwright).
// (A `node --env-file` flag doesn't work: Next passes it to workers via NODE_OPTIONS, where
// Node rejects it.)
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync(rootEnv, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const SERVER_EXTERNALS = ['@electric-sql/pglite', 'pg', 'ioredis', 'pino', '@renderinc/sdk', 'msw'];

const config: NextConfig = {
  // Render runs `next start` in the built checkout (no standalone copy step needed).
  // Lets a second build run while another `next start` holds .next (local verification only).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Workspace packages ship TypeScript sources.
  transpilePackages: [
    '@vigil/agent',
    '@vigil/config',
    '@vigil/core',
    '@vigil/db',
    '@vigil/gate',
    '@vigil/paypal',
    '@vigil/policy',
    '@vigil/replay',
    '@vigil/scripts',
    '@vigil/tasks',
    '@vigil/workflows',
  ],
  // Native/wasm or heavy server-only dependencies are loaded at runtime, not bundled.
  serverExternalPackages: SERVER_EXTERNALS,
  poweredByHeader: false,
  // Don't let `next dev` write AGENTS.md / CLAUDE.md into apps/web.
  agentRules: false,
  // Hide the "N" dev indicator in the bottom-left corner (compile/runtime errors still show).
  devIndicators: false,
  // Workspace packages use NodeNext-style `./x.js` specifiers for `./x.ts` sources.
  webpack(cfg, { isServer }) {
    cfg.resolve ??= {};
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    if (isServer) {
      // serverExternalPackages doesn't catch imports made from transpiled workspace packages,
      // so force these to load from node_modules at runtime (PGlite needs its own wasm files).
      const prev = Array.isArray(cfg.externals)
        ? cfg.externals
        : cfg.externals
          ? [cfg.externals]
          : [];
      cfg.externals = [
        ...prev,
        (
          { request }: { request?: string },
          callback: (err?: Error | null, result?: string) => void,
        ) => {
          if (
            request &&
            SERVER_EXTERNALS.some((e) => request === e || request.startsWith(`${e}/`))
          ) {
            return callback(null, `import ${request}`);
          }
          callback();
        },
      ];
    }
    return cfg;
  },
};

export default config;
