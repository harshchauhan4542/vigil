import type { NextConfig } from 'next';

const SERVER_EXTERNALS = ['@electric-sql/pglite', 'pg', 'ioredis', 'pino', '@renderinc/sdk', 'msw'];

const config: NextConfig = {
  output: 'standalone',
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
