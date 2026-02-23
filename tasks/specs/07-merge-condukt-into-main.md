# Merge Condukt Back Into Main Codebase

**Priority:** 7 — Velocity
**Depends on:** Nothing
**Blocks:** Nothing (can be done anytime, but simplifies future orchestration work)

---

## Problem

The `condukt-ai` and `condukt-openhive` packages add indirection with exactly one consumer. You have 34 source files across two packages implementing a generic orchestration abstraction that's only used by OpenHive. The type translations between three systems (OpenHive plan → condukt-ai tasks → condukt-ai run records) add cognitive overhead and make debugging harder.

## What Exists

- `packages/condukt-ai/src/` — 25 files: generic orchestration engine, pipeline, trials, diagnostics, providers, JSON utilities
- `packages/condukt-openhive/src/` — 9 files: OpenHive-specific planner, orchestrator, worker adapter, context heuristic
- `src/main/orchestration/service.ts` imports from `@openhive/condukt-openhive` which re-exports from `condukt-ai`
- `src/main/orchestration/run-repository.ts` implements the `RunStore` interface from condukt-ai

## What's Actually Used by OpenHive

- `runOpenHiveOrchestration()` from condukt-openhive — the main entry point
- `extractJson()` from condukt-openhive — JSON extraction with code fence handling
- `OpenHiveProgressPayload`, `OpenHiveTaskExecutionInput` types
- The orchestration engine (`condukt-ai/src/orchestration/engine.ts`) — task execution with dependency resolution
- `MemoryRunStore` from condukt-ai — in-memory run tracking

## What's NOT Used by OpenHive

- `pipeline/` — entire pipeline module (class, execution, graph, llm, runtime, trace, types) — 7 files
- `trials/` — trial normalization, session, summary — 5 files
- `providers.ts` — provider abstractions
- `diagnostics.ts` — diagnostic utilities
- `release_identity.ts` — release tracking
- `tanstack.ts` — TanStack integration layer

## Implementation

### 1. Identify the minimal surface

Only bring over what `service.ts` actually imports:
- `runOpenHiveOrchestration` function
- `extractJson` utility
- Orchestration engine (task execution with DAG resolution)
- Run store types and memory implementation
- Context heuristic
- Planner parse/repair logic

### 2. Create `src/main/orchestration/engine/`

Move the relevant condukt code here:
- `engine.ts` — task execution with dependency resolution (from `condukt-ai/src/orchestration/engine.ts`)
- `run-store.ts` — run tracking (from `condukt-ai/src/orchestration/memory-run-store.ts`)
- `types.ts` — orchestration types (merge from both packages)
- `json.ts` — extractJson utility (from `condukt-ai/src/json.ts`)
- `planner.ts` — plan parsing/repair (from `condukt-openhive/src/planner.ts`)
- `context-heuristic.ts` — (from `condukt-openhive/src/context-heuristic.ts`)

### 3. Update imports

In `service.ts`, change imports to point to local modules instead of package imports.

### 4. Remove packages

- Delete `packages/condukt-ai/`
- Delete `packages/condukt-openhive/`
- Remove from `pnpm-workspace.yaml`
- Remove from root `package.json` workspace config

### 5. Move tests

From `packages/condukt-openhive/src/*.test.ts` to `src/main/orchestration/engine/__tests__/`

## Risk

Low. Purely structural refactor. No behavior changes. Run `pnpm typecheck && pnpm test` after each step.

## Files to Create

- `src/main/orchestration/engine/engine.ts`
- `src/main/orchestration/engine/run-store.ts`
- `src/main/orchestration/engine/types.ts`
- `src/main/orchestration/engine/json.ts`
- `src/main/orchestration/engine/planner.ts`
- `src/main/orchestration/engine/context-heuristic.ts`

## Files to Modify

- `src/main/orchestration/service.ts` — update imports
- `pnpm-workspace.yaml` — remove packages
- `package.json` — remove workspace references

## Files to Delete

- `packages/condukt-ai/` (entire directory)
- `packages/condukt-openhive/` (entire directory)
