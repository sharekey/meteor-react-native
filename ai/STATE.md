State Log (keep this updated)

Last update: [please update]

Current Version: 2.8.2

Build
- ESM‑only. Build with `npm run build` → outputs to `dist`.
- TypeScript: module=ES2020, moduleResolution=node, node types included.

Tests
- Local only: `npm run test:coverage` (Mocha + ts-node/esm loader).
- Root hooks in `test/hooks/mockServer.cjs` (CJS). ESM shim at `test/hooks/mockServer.js` for imports.
- Combined check: `npm run check` (lint + tests).

CI
- node.js.yml: runs lint and build (Node 20). Tests are not run by default.
- release.yml: on tag `v*`, builds, `npm pack`, attaches tgz to GitHub Release.

Conventions
- No CommonJS in dist. Exports map to ESM files.
- Prettier for formatting; `.prettierignore` excludes dist and mocharc.
- Secure RNG is required for Random.id(); RN projects should include `react-native-quick-crypto` or `react-native-get-random-values`.

Notes / Open Items
- If enabling CI tests in the future, reintroduce a unified test job with Node 20 and ts-node/esm loader.
- Keep this file in sync after any change to build/test/release or developer workflows.

