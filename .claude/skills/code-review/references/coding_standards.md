# Coding Standards (OpenWaggle)

## Baseline expectations
- Follow repository-local standards first (`AGENTS.md`, `LEARNINGS.md`, and relevant docs under `docs/`).
- Keep code deterministic, readable, and easy to reason about.
- Preserve explicit auth/access checks on protected paths.
- Keep generated files read-only unless regeneration is part of the change.

## Architecture and correctness
- Respect Electron process boundaries:
  - `src/main/`: node-only logic (agent loop, tools, IPC handlers, persistence)
  - `src/preload/`: context bridge and typed API wiring only
  - `src/renderer/src/`: UI and state logic
- Keep IPC contracts aligned across main/preload/renderer with `src/shared/types/ipc.ts` as source of truth.
- Preserve provider registry architecture (`src/main/providers/`) and dynamic model lookup behavior.
- Keep runtime validation at trust boundaries (for example Zod on tool args and persistence inputs).

## Frontend and UX
- Ensure loading, empty, success, and error states are explicit.
- Preserve keyboard/focus accessibility for new interactions.
- Avoid render-time side effects and brittle timing assumptions.
- Respect React Compiler rules: avoid `React.memo`, `useMemo`, `useCallback` for render optimization.
- Use granular Zustand selectors; avoid broad store subscriptions.
- Use `cn()` for conditional Tailwind classes.

## Environment and configuration
- Avoid direct `process.env` / `import.meta.env` usage outside approved env modules:
  - main: `src/main/env.ts`
  - renderer: `src/renderer/src/env.ts`
- Avoid leaking server-only values into renderer paths.
- Treat `electron.vite.config.ts` and provider wiring changes as high risk.

## Test and verification standards
- OpenWaggle has no automated test framework configured by default; require manual verification notes for behavior/UI changes (`pnpm dev`).
- Run repository checks where applicable:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm check`
- Require explicit rationale when behavior changes lack verification evidence.

## Review reporting standards
- Report findings in severity order (`P0` to `P3`).
- Include precise file/line evidence.
- Call out missing verification coverage as findings when behavior changed.
- If no defects are found, still note residual risks and validation gaps.
