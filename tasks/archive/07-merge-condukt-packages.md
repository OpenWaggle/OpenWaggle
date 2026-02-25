# Spec 07: Merge Condukt Packages Into Main Codebase

## Status: Done

## Summary

Inlined the 6 used source files from `packages/condukt-ai` and `packages/condukt-openwaggle` into `src/main/orchestration/engine/`, updated all consumers, moved tests, and deleted both workspace packages.

## Changes

### New files (engine module)
- [x] `src/main/orchestration/engine/types.ts` — merged types from both packages
- [x] `src/main/orchestration/engine/memory-run-store.ts`
- [x] `src/main/orchestration/engine/engine.ts`
- [x] `src/main/orchestration/engine/json.ts` — `extractJson` extracted from planner
- [x] `src/main/orchestration/engine/planner.ts` — without `extractJson`
- [x] `src/main/orchestration/engine/context-heuristic.ts`
- [x] `src/main/orchestration/engine/worker-adapter.ts`
- [x] `src/main/orchestration/engine/orchestrator.ts` — uses `createLogger` instead of `console.warn`
- [x] `src/main/orchestration/engine/index.ts` — barrel re-exports

### Updated consumers
- [x] `src/main/orchestration/service.ts` — imports from `./engine`
- [x] `src/main/orchestration/run-repository.ts` — imports from `./engine`
- [x] `src/main/orchestration/service.unit.test.ts` — mock path updated

### Moved tests
- [x] `engine/__tests__/planner.unit.test.ts`
- [x] `engine/__tests__/context-heuristic.unit.test.ts`
- [x] `engine/__tests__/orchestrator.unit.test.ts`
- [x] `engine/__tests__/engine.unit.test.ts`

### Removed infrastructure
- [x] `packages/condukt-ai/` directory deleted
- [x] `packages/condukt-openwaggle/` directory deleted
- [x] `packages/` directory removed
- [x] `pnpm-workspace.yaml` — removed `packages/*` entry
- [x] `package.json` — removed `typecheck:packages`, `test:packages`, `lint:packages` scripts
- [x] `tsconfig.node.json` — removed path aliases and includes
- [x] `electron.vite.config.ts` — removed aliases

### Fixes applied during migration
- `orchestrator.ts`: replaced `console.warn` logger with `createLogger('orchestration')`
- `orchestrator.ts`: removed `as Record<string, unknown>` cast — `'text' in output` narrowing is sufficient
- `planner.ts`: replaced `as Record<string, unknown>` in `tryRepairPlan` with `isRecord()` type guard
- Test files: renamed to `.unit.test.ts` convention

## Verification

- `pnpm typecheck` — clean
- `pnpm test:unit` — 48 files, 376 tests passed
- `pnpm test:integration` — 13 files, 79 tests passed
- `pnpm test:component` — 7 files, 68 tests passed
- `pnpm lint` — clean
- `pnpm build` — successful
