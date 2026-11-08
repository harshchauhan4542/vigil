# 2026-11-02 — Step 00: Monorepo and tooling

**Session goal:** an empty but fully working monorepo where every quality check runs, plus a private GitHub repo with CI.
**Result:** ✅ Done
**Branch / commit:** `step-00-monorepo`

## What was done

- Created the **private** GitHub repo `harshchauhan4542/vigil` and pushed `main`.
- pnpm 10.34.9 workspaces (`apps/*`, `packages/*`, `tooling/*`) + Turborepo 2.11 (`build`, `lint`, `typecheck`, `test`).
- `tooling/tsconfig` (base, node-lib, nextjs) and `tooling/eslint` (flat config, typescript-eslint, Prettier).
- Trust-boundary `no-restricted-imports` rules in `tooling/eslint/index.js`, proven by `tooling/eslint/test/boundaries.test.js` (13 forbidden + 5 allowed imports).
- Package shells `core config db paypal policy detectors agent replay tasks`, each with `src/index.ts` and one test.
- `.nvmrc` (22), `.gitattributes` (LF), `.prettierrc.json`, `.env.example`, root `vitest.config.ts` (projects).
- `.github/workflows/ci.yml`: install → format check → lint → typecheck → test → build → "no .env tracked".

## Checks

| Check                           | Result                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| lint / typecheck / test / build | ✅                                                               |
| Step "Done when" checks         | ✅ `packages/agent` importing `@vigil/paypal/actions` fails lint |

## Decisions and deviations from the plan

- Repo is **private** (user's request). Devpost needs a public repo at submission: flip visibility before Step 15.
- pnpm installed with `npm i -g pnpm@10.34.9` because `corepack enable` needs admin rights on this machine (EPERM in `C:\Program Files\nodejs`).
- TypeScript 5.9.3 and ESLint 9.39.5 (not TS 7 / ESLint 10): typescript-eslint 8.72 supports TS `<6.1`.
- Internal packages export their TypeScript source (`exports: ./src/index.ts`); `build` emits `dist/` to prove it compiles. Apps bundle/transpile later.

## Problems and how they were solved

- `corepack enable` EPERM → global npm install of pinned pnpm (CI uses `pnpm/action-setup`, which reads `packageManager`).

## Left over / next

- Next: Step 1, Config and core domain.

## Needs from the user

- Nothing for this step.
