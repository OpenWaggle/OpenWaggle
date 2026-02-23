# Fix Orchestration Executor Permissions

**Priority:** 2 — Honesty
**Depends on:** Task 1 (tool approval flow)
**Blocks:** Nothing directly, but unlocks orchestration for real coding tasks

---

## Problem

Orchestration executors only get `readFile` + `glob` tools. They cannot write files, edit code, or run commands. This means the multi-task planner decomposes work, runs tasks in parallel, and can only read things. When a user asks "refactor this module" or "add tests for X", orchestration silently fails to do the actual work.

## What Exists

- `src/main/orchestration/project-context.ts:250-329` — `createExecutorTools()` creates a standalone `readFile` and `glob` that bypass `AsyncLocalStorage` context
- `src/main/orchestration/service.ts:239` — Executor prompt tells LLM: "You have access to readFile and glob tools"
- `src/main/orchestration/service.ts:245` — Synthesis tasks get zero tools: `const tools = input.task.kind === 'synthesis' ? [] : executorTools`
- The classic agent loop (`agent-loop.ts`) uses the full tool registry via `getServerTools()` which includes all 8+ tools

## Why Executors Don't Have Write Tools

- `createExecutorTools()` in `project-context.ts` creates its own tool instances that don't use `AsyncLocalStorage` (`toolContextStorage`). The main tools in `src/main/tools/tools/` all call `getToolContext()` which reads from `AsyncLocalStorage` — but orchestration executors run outside `runWithToolContext()`.
- Adding `writeFile`/`editFile`/`runCommand` to executors also requires approval gating, which ties into Task 1.

## Implementation (Two Options)

### Option A — Run executors inside tool context (recommended)

1. In `service.ts`, wrap executor calls in `runWithToolContext()` (import from `define-tool.ts`)
2. Pass the full tool set from `getServerTools()` instead of `createExecutorTools()`
3. This gives executors the same tools as the classic agent, including approval gating
4. Requires Task 1 to be done first (so approval works in sandbox mode)

### Option B — Extend `createExecutorTools()` with write tools

1. Add `writeFile`, `editFile`, `runCommand` implementations in `project-context.ts`
2. Each must enforce project path boundaries (already handled by `isPathInside` at line 240)
3. Bypass `AsyncLocalStorage` like the existing tools do
4. No approval gating — only use this option if executors always run in full-access mode
5. Simpler but less safe

**Recommended: Option A after Task 1 is complete.**

## Additional Changes

- Update executor prompt (`service.ts:239`) to list all available tools
- Update `TOOL_VERBS` and `TOOL_PRIMARY_ARG` maps (`service.ts:621-637`) to include all tools for activity formatting
- Consider a `maxWriteOps` limit per executor task to prevent runaway writes
- Add orchestration mode UI indicator that shows "read-only" vs "full" executor capability

## Files to Touch

- `src/main/orchestration/service.ts` — executor tool resolution, prompt update
- `src/main/orchestration/project-context.ts` — potentially remove `createExecutorTools()` if going Option A
- `src/main/tools/define-tool.ts` — ensure `runWithToolContext` is exported and usable from orchestration

## Tests

- Unit test: executor receives write tools when run inside tool context
- Integration test: orchestration task that writes a file succeeds
- Verify project boundary enforcement still works within orchestration
