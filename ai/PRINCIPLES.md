Working Principles (for AI agents)

Core
- Read this ai/ folder first. Treat it as the source of truth for conventions.
- Make surgical, minimal changes. Do not introduce CJS, keep ESM only.
- Prefer clarity over cleverness; keep code consistent with the existing style.
- Always run `npm run check` before handing changes back.

Types & Safety
- Favor explicit types over `any`. Keep strict TS flags green.
- If you must use `require` in guarded, Node‑only paths, keep it inside `try/catch` with fallbacks.

Build/Test/Release
- Build: do not check in `dist`. CI builds it. Release workflow attaches the tarball on tags.
- Tests: use Mocha with ts-node/esm loader. Root hooks live in `test/hooks`.
- If you changed CI or release logic, document it in `ai/STATE.md` and this folder.

Documentation Discipline
- For any notable change (behavioral, build, CI),
  1) update relevant docs (README/ai/README),
  2) add a short note to `ai/STATE.md` with date/time and rationale.

Out of Scope
- Do not add unrelated refactors, linters, formatters, or tooling changes unless requested.
- Do not re‑enable test jobs in CI unless requested (they are currently local‑only).

