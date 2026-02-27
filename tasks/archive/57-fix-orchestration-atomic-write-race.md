# Spec 57: Fix Orchestration Atomic Write Race

## Context
- Reported issue: orchestration run fails after long executor tasks with generic `orchestration run failed`.
- Log/run evidence indicates a task can remain `running` with zero attempts while sibling task completes, then run ends as failed/deadlock.
- This task does not map to a planned/future HC-UI item in `docs/product/ui-interaction-prd.md`; it is backend orchestration reliability work.

## Root Cause Hypothesis
- `atomicWriteJSON` writes to a fixed temp path (`<file>.tmp`).
- Concurrent saves to the same run file (parallel orchestration task lifecycle writes) race on that shared temp path.
- One writer can rename the temp file while another still expects it, causing write failures that bypass normal task failure bookkeeping.

## Plan
- [x] Update `atomicWriteJSON` to use per-call unique temp file names in the same directory.
- [x] Add regression test proving concurrent writes do not reject due temp-file collisions.
- [x] Harden orchestration engine so pre-execution task setup failures are handled as task failures (not deadlocks).
- [x] Add regression test for pre-execution failures in task lifecycle handling.
- [x] Run targeted tests for orchestration engine and atomic write paths.
- [x] Validate no unintended file changes outside the scoped fix.

## Review
- Root cause confirmed from persisted run `96eecddc-e11c-4355-9872-31fac6ca417c`: one task remained `running` with zero attempts while sibling task completed, consistent with lifecycle save failure during parallel writes.
- Fixed `src/main/utils/atomic-write.ts` to use unique temp file names per write call, removing same-file temp path collisions under concurrent writes.
- Added regression coverage in `src/main/utils/__tests__/atomic-write.unit.test.ts` (`supports concurrent writes to the same file`).
- Hardened `src/main/orchestration/engine/engine.ts` by moving task pre-execution setup inside the guarded `try/catch`, so setup-time exceptions (event emission/save failures) become normal task failures with attempts/error metadata.
- Added regression coverage in `src/main/orchestration/engine/__tests__/engine.unit.test.ts` (`fails task cleanly when task_started emission throws`).
- Verification:
  - `pnpm vitest src/main/orchestration/engine/__tests__/engine.unit.test.ts src/main/utils/__tests__/atomic-write.unit.test.ts`
  - `pnpm typecheck:node`
