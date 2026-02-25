# 46 — Orchestration Service Refactor + Hardening

**Status:** Done
**Priority:** P2
**Severity:** High
**Category:** Refactor
**Depends on:** None
**Origin:** Manual refactor plan (service.ts battle hardening)

---

## Problem

`src/main/orchestration/service.ts` had accumulated planning, streaming, model I/O, prompt construction, parsing, and orchestration event handling in one module. This raised regression risk, reduced testability, and made stream lifecycle/cancellation behavior difficult to reason about under failure and fallback paths.

## Implementation

### Phase 1: Structural extraction (behavior-preserving)

- [x] Create a compatibility facade at `src/main/orchestration/service.ts` that preserves public exports:
  - `runOrchestratedAgent(...)`
  - `hasWebIntent(...)`
- [x] Introduce modular service internals under `src/main/orchestration/service/`:
  - `types.ts`
  - `deps.ts`
  - `runner.ts`
  - `stream-session.ts`
  - `model-runner.ts`
  - `planner.ts`
  - `task-progress.ts`
  - `tool-activity.ts`
  - `conversation-summary.ts`
- [x] Add dependency-injected orchestration runner factory:
  - `createOrchestratedAgentRunner(deps)`

### Phase 2: Safety hardening

- [x] Stream lifecycle invariants via `StreamSession`:
  - single `RUN_STARTED` per run
  - message start/content/end pairing
  - terminal guarding to prevent post-terminal stream writes
  - fallback handoff path closes message without emitting `RUN_FINISHED`
- [x] Error propagation + parsing hardening:
  - unified `RUN_ERROR` handling in model runner
  - planner JSON parse failures surfaced through visible fallback messaging
  - resilient tool input parsing from `TOOL_CALL_END.input` and streamed `TOOL_CALL_ARGS`
- [x] Cancellation consistency:
  - abort errors classified distinctly from generic failures
  - aborted runs return `cancelled` status (not accidental fallback)
- [x] Prompt tuning with invariant preservation:
  - clearer planner/executor wording while preserving decomposition constraints and direct-response gating logic

### Phase 3: Battle-test expansion

- [x] Split planner/web-intent coverage into focused suite:
  - `src/main/orchestration/service/planner.unit.test.ts`
- [x] Add stream state-machine lifecycle coverage:
  - `src/main/orchestration/service/stream-session.unit.test.ts`
- [x] Extend orchestration service tests for new hardening behavior:
  - cancellation before message start
  - cancellation after ack stream starts
  - malformed progress payload handling
- [x] Add runner integration suite against real orchestration engine with controlled chat streams:
  - `src/main/orchestration/service/runner.integration.unit.test.ts`

## Public Interface Impact

- No external API contract changes.
- `runOrchestratedAgent` and `hasWebIntent` signatures remain unchanged.
- `agent-handler` integration remains unchanged.

## Tests

- Unit:
  - `src/main/orchestration/service.unit.test.ts`
  - `src/main/orchestration/service/planner.unit.test.ts`
  - `src/main/orchestration/service/stream-session.unit.test.ts`
- Integration-style unit:
  - `src/main/orchestration/service/runner.integration.unit.test.ts`
- Full validation gates:
  - `pnpm check`
  - `pnpm test`
  - `pnpm build`

## Review

- Service logic is now decomposed into smaller, purpose-specific modules.
- Fallback, cancellation, and terminal stream semantics are now explicitly modeled rather than ad-hoc.
- Added focused suites improve signal for regressions in planner logic and stream invariants.
- Integration coverage now exercises the runner against real orchestration engine boundaries using deterministic mocked model streams.
