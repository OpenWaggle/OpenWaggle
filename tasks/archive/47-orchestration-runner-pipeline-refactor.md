# 47 — Orchestration Runner Pipeline Refactor

**Status:** Done
**Priority:** P2
**Severity:** Medium
**Category:** Refactor
**Depends on:** 46-orchestration-service-refactor-hardening
**Origin:** User request (split createOrchestratedAgentRunner into smaller pipeline phases)

---

## Problem

`createOrchestratedAgentRunner` in `src/main/orchestration/service/runner.ts` still coordinates too many concerns in one function, which increases change risk and makes phase-level behavior harder to reason about and test.

## Plan

### Phase 1: Pipeline extraction (behavior-preserving)

- [x] Introduce internal phase helpers for run preparation, planning, direct path, orchestration path, and terminal finalization.
- [x] Keep `createOrchestratedAgentRunner` as a short coordinator with unchanged external behavior.
- [x] Preserve stream and fallback invariants (no semantic changes).

### Phase 2: Prompt module extraction

- [x] Move execution/synthesis prompt builders into a dedicated module under `src/main/orchestration/service/`.
- [x] Keep prompt constraints and output contracts unchanged.

### Phase 3: Test expansion

- [x] Add focused prompt builder unit tests.
- [x] Add regression tests for phase branching and terminal behavior through `runOrchestratedAgent`.
- [x] Keep existing orchestration service and integration suites green.

## Validation

- [x] `pnpm test`
- [x] `pnpm check`
- [x] `pnpm build`

## Review

- `runner.ts` now follows a phase pipeline (`prepare -> plan -> direct/orchestrate -> finalize/error`) and `createOrchestratedAgentRunner` is a thin coordinator.
- Execution and synthesis prompt builders were extracted to `prompts.ts` with dedicated prompt unit tests.
- Added regression coverage for:
  - immediate fallback on model/provider resolution failure,
  - cancelled terminal path when orchestration engine returns cancelled status,
  - task narration streaming on `task_started`,
  - direct planner path through integration runner.
- A pipeline regression surfaced during refactor (returning async stage promises from inside `try` bypassed catch); fixed by awaiting stage calls in the coordinator and protected by existing cancellation tests.
