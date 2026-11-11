// Bundle the Render entry points: workspace TypeScript and pure-JS dependencies go into the
// bundle; packages with wasm/native/worker files stay external (direct deps of this app).
import { rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

rmSync('dist', { recursive: true, force: true });

const EXTERNAL = ['@electric-sql/pglite', 'pg', 'ioredis', 'pino', '@renderinc/sdk', 'msw'];
await build({
  entryPoints: { worker: 'src/worker.ts', cron: 'src/cron.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  resolveExtensions: ['.ts', '.js', '.mjs', '.json'],
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          EXTERNAL.some((e) => args.path === e || args.path.startsWith(`${e}/`))
            ? { path: args.path, external: true }
            : undefined,
        );
        // Workspace sources import `./x.js` meaning `./x.ts`.
        b.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, async (args) => {
          const dir = args.resolveDir.split(path.sep).join('/');
          if (!['/packages/', '/apps/', '/scripts/'].some((d) => dir.includes(d))) return undefined;
          const r = await b.resolve(args.path.replace(/\.js$/, '.ts'), {
            resolveDir: args.resolveDir,
            kind: args.kind,
          });
          return r.errors.length ? undefined : { path: r.path };
        });
      },
    },
  ],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log('built dist/worker.js, dist/cron.js, dist/cli.js');
