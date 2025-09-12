AI Working Folder

Purpose
- This folder is the first place an AI agent should read when starting work on this repository.
- It captures project facts, conventions, guard‑rails, and the exact commands to run.
- Rule: after any change you make, update ai/STATE.md with a short summary.

Project Quick Facts
- Language: TypeScript
- Module format: ESM only (package.json has "type": "module")
- Build: `npm run build` (tsc → outputs to `dist`)
- Entry points: exports point to `dist/src/*`, `dist/lib/*`, `dist/helpers/*`
- No CommonJS in dist. Do not add CJS outputs.
- Lint: Prettier (`npm run lint` / `npm run lint:fix`)
- Tests: Mocha + ts-node/esm loader (`npm run test:coverage`). Root hooks live in `test/hooks`.
- Combined check: `npm run check` runs lint + tests locally.
- CI (GitHub Actions):
  - `.github/workflows/node.js.yml` runs lint and build on Node 20. (No unit tests by default.)
  - `.github/workflows/release.yml` builds on tag `v*`, packs, and attaches the tarball to the release.

TypeScript/Build Conventions
- ESM only: `compilerOptions.module = ES2020`.
- Resolution: `moduleResolution = node`.
- Node types included: `types = ["node"]` (some files use `require` in guarded paths).
- Strict flags: `strict = true`, `noUncheckedIndexedAccess = true`, `exactOptionalPropertyTypes = true`.
- Do not commit `dist/` (CI and the release workflow produce it).

Runtime Notes
- Random IDs: `lib/Random.ts` requires a secure RNG. If none is available it throws.
  - React Native: prefer `react-native-quick-crypto`, or `react-native-get-random-values` polyfill.
  - Node: ensure `globalThis.crypto` or the `crypto` module is available.
- DDP/Eventing: built on `eventemitter3`; prefer `.on()`/`.off()` APIs.

What to do on each change
1) Run: `npm run check` (lint + tests). Fix issues.
2) If you touched build/test/release config, reflect it here and in `ai/STATE.md`.
3) Update `ai/STATE.md` (what changed, why, any follow‑ups).
4) Keep changes minimal and ESM‑only.

Where to look first
- package.json (scripts, exports, engines)
- tsconfig.json (ESM only config)
- .github/workflows/* (CI/build/release)
- test/hooks/* (Mocha root hooks)

