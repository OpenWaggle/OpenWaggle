# 06 — Orchestration Executor Permissions

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None (Task 01 approval flow is done)
**Origin:** Spec 02

---

## Problem

Orchestration executors only get `readFile` + `glob` tools. They cannot write files, edit code, or run commands. This means the multi-task planner decomposes work, runs tasks in parallel, and can only read things. When a user asks "refactor this module" or "add tests for X", orchestration silently fails to do the actual work.

## What Exists

- `src/main/orchestration/project-context.ts:250-329` — `createExecutorTools()` creates a standalone `readFile` and `glob` that bypass `AsyncLocalStorage` context
- `src/main/orchestration/service.ts:239` — Executor prompt tells LLM: "You have access to readFile and glob tools"
- `src/main/orchestration/service.ts:245` — Synthesis tasks get zero tools
- The classic agent loop (`agent-loop.ts`) uses the full tool registry via `getServerTools()`

## Implementation

### Option A — Run executors inside tool context (recommended)

1. In `service.ts`, wrap executor calls in `runWithToolContext()`
2. Pass the full tool set from `getServerTools()` instead of `createExecutorTools()`
3. This gives executors the same tools as the classic agent, including approval gating

### Option B — Extend `createExecutorTools()` with write tools

1. Add `writeFile`, `editFile`, `runCommand` implementations in `project-context.ts`
2. Each must enforce project path boundaries
3. No approval gating — only use this if executors always run in full-access mode

**Recommended: Option A.**

## Additional Changes

- [ ] Update executor prompt to list all available tools
- [ ] Update `TOOL_VERBS` and `TOOL_PRIMARY_ARG` maps for activity formatting
- [ ] Consider a `maxWriteOps` limit per executor task to prevent runaway writes
- [ ] Add orchestration mode UI indicator showing "read-only" vs "full" capability

## Files to Touch

- `src/main/orchestration/service.ts` — executor tool resolution, prompt update
- `src/main/orchestration/project-context.ts` — potentially remove `createExecutorTools()`
- `src/main/tools/define-tool.ts` — ensure `runWithToolContext` is exported

## Tests

- Unit: executor receives write tools when run inside tool context
- Integration: orchestration task that writes a file succeeds
- Unit: project boundary enforcement still works within orchestration
