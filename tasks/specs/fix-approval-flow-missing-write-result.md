# Fix Approval Flow Causing "File Saved" Without Actual Write

**Status:** In Progress
**Priority:** P1
**Severity:** Reliability
**Depends on:** None
**Origin:** User report + approval regression follow-up

## Problem Statement
- Users ask to save an auto-converted attachment (for example `Pasted Text 1.md`) to project root.
- UI may show `Wrote <file>` (or later `Requested writeFile <file>`) but no file appears in repository.
- Logs show `[agent-run] tool-call-start/end` but no `[tools] tool:start/tool:end` execution logs in failing runs.

## Confirmed Findings
- Baseline update (2026-03-07): the old TanStack React continuation deadlock workaround is no longer relevant here.
  - Commit `c1100a6` upgraded `@tanstack/ai-react` to `0.6.2`
  - The removed `waitForNotLoading()` workaround must not be reintroduced
  - Any remaining failure must be treated as either OpenWaggle continuation/persistence truthfulness drift or a still-needed narrow `@tanstack/ai` runtime patch
- For conversation `492d8088-29c4-46f8-a4d1-0f176ed87c1b`, persisted assistant turn contains:
  - `tool-call` (`writeFile`)
  - no `tool-result`
  - followed by `(no response)` in a later empty run
- This means the model produced a tool call, but execution did not complete in that turn.
- In sandbox mode, this is consistent with approval-pending flows.
- Current observability is misleading:
  - `onToolCallEnd` is emitted for raw `TOOL_CALL_END` chunks even when `result` is missing.
  - `tool-call-end isError:false` can appear without any real tool execution.
- Prior continuation-payload loss has already been partly addressed in repo code:
  - `AgentSendPayload.continuationMessages` already supports `UIMessage[]`
  - `agent-loop.ts` already uses `normalizeContinuationAsUIMessages(...)` for continuation runs
  - The remaining gap is narrower: truthfulness and observability around approval-marker results versus concrete execution completion
- Secondary reliability risk:
  - approval-placeholder payloads (`pendingExecution` / approval status markers) can still be interpreted as ordinary completed results in some renderer/main-process paths, making the tool appear completed before a real execution result is persisted.

## Scope
- In scope:
  - Approval-pending stream lifecycle correctness
  - Accurate execution-state representation in logs and UI
  - Deterministic completion of approved write operations
  - Regression tests for approval + attachment save
- Out of scope:
  - Changing default execution mode semantics
  - Removing approval requirement in sandbox mode

## Plan

### 1. Re-baseline against current TanStack versions
- [x] Confirm the old `waitForNotLoading` / continuation deadlock workaround is absent and stays absent.
- [x] Audit `patches/@tanstack__ai@0.6.1.patch` and classify which hunks are still required for current approval execution correctness.
- [x] Avoid adding any new renderer loading/polling workaround for approval continuation.

### 2. Add Deterministic Approval Tracing
- [x] Add permanent structured approval diagnostics in:
  - `src/main/agent/stream-processor.ts`
  - `src/main/agent/agent-loop.ts`
  - `src/main/ipc/agent-handler.ts`
  - `src/renderer/src/lib/ipc-connection-adapter.ts`
- [x] Log per-run chunk timeline:
  - chunk type order
  - whether `TOOL_CALL_END.result` exists
  - whether approval custom events arrived
  - whether continuation payload was UI-message based
  - whether adapter closed due terminal chunk vs grace/fallback path
  - whether persistence finished with a concrete `tool-result`

### 3. Correct Execution-State Contract
- [x] Separate concepts in runtime events:
  - tool input finalized (`TOOL_CALL_END` without result)
  - tool execution completed (`TOOL_CALL_END` with result)
- [x] Update lifecycle telemetry so completion logs do not imply execution completion unless result exists.
- [x] Keep `tool-result` as sole source of truth for completed execution in persisted conversation parts.
- [x] Treat approval-placeholder payloads (`pendingExecution`, approval status payloads) as non-complete results in the renderer UI.

### 4. Fix Approval-Pending Stream Handoff
- [x] Keep the current TanStack stream model and avoid reintroducing upstream-deadlock workarounds.
- [x] Tighten `ipc-connection-adapter` close diagnostics and approval-pending handling without adding loading-state polling.
- [ ] Introduce explicit close semantics:
  - close on terminal chunk (`RUN_ERROR` or `RUN_FINISHED` non-`tool_calls`)
  - for approval-pending cases, keep the stream alive long enough to observe the real execution result or an explicit terminal failure
- [ ] Only add new main-process signaling if current chunk contracts prove insufficient during implementation.

### 5. Ensure Approval Continuation Executes Real Tool
- [x] Validate `addToolApprovalResponse` continuation payload carries the pending tool call state expected by TanStack.
- [ ] Add guardrails so approval-response runs cannot complete empty when pending write tool call exists.
- [x] Verify `writeFile` receives attachment context on continuation runs (already partially fixed).

### 6. UI Accuracy Improvements
- [x] Keep unresolved states clearly non-success (`Requested ...` / `Awaiting approval`) and never show completed verbs without `tool-result`.
- [ ] Ensure approval UI remains visible and actionable until continuation resolves with a tool result or explicit error.

### 7. Test Coverage
- [x] Unit:
  - continuation payload serialization tests (`approval-responded` survives renderer -> main)
  - placeholder approval payloads do not render as completed tool executions
  - lifecycle event classification tests (`input-finalized` vs `execution-complete`)
  - `ipc-connection-adapter` diagnostics/close tests stay aligned with current TanStack behavior
- [ ] Integration:
  - `writeFile` in sandbox mode with approval handshake to actual file existence assertion
  - continuation run from UI approval state executes server `writeFile` exactly once
- [x] E2E:
  - at minimum, assert unresolved approval/placeholder tool state never renders as a completed write after conversation reload
  - if provider-backed approval flow is available in test env, extend auto-attach save to assert file existence after approval

## Acceptance Criteria
- Approving `writeFile` in sandbox mode always produces:
  - real `[tools] tool:start/tool:end` logs
  - persisted `tool-result`
  - file present at requested path
- Continuation payload reaching main process contains approval-resolved UI context required by TanStack to execute approved server tools.
- Without approval, tool remains pending and UI reflects pending state (not success).
- No run ends with “completed write” messaging unless file operation actually executed.

## Verification Commands
- `pnpm check`
- `pnpm exec vitest run -c vitest.unit.config.ts src/renderer/src/lib/ipc-connection-adapter.unit.test.ts src/main/agent/stream-processor.unit.test.ts src/main/agent/stream-part-collector.unit.test.ts`
- `pnpm exec vitest run -c vitest.integration.config.ts src/main/tools/tools/file-ops.integration.test.ts`
- `pnpm exec playwright test e2e/auto-attach.e2e.test.ts`

## Risks
- Stream lifecycle changes can regress other tool paths (askUser/proposePlan/orchestrate).
- Over-eager synthetic terminal emission may prematurely end streams.
- Must preserve background-run reconnection behavior.

## Rollout Strategy
- Implement behind minimal-risk path:
  - first instrumentation and assertions
  - then contract and adapter fix
  - then cleanup logs and finalize tests

## Review Notes (2026-03-07)

- The upstream TanStack React continuation deadlock fix is treated as baseline: no `waitForNotLoading`-style workaround was reintroduced.
- The local `@tanstack/ai` patch remains in place after audit; this pass focused on narrowing OpenWaggle-side truthfulness and observability gaps on top of the upgraded stack instead of layering a new continuation workaround.
- Approval-placeholder payloads (`pendingExecution` / approval status markers) now stay in a non-complete renderer state, so reloaded conversations no longer render `Wrote <file>` before a concrete execution result exists.
- Lifecycle telemetry now distinguishes `tool-call-input-complete` from real `tool-call-end` completion, which removes misleading logs where a bare `TOOL_CALL_END` without `result` looked like a finished tool execution.
- Permanent approval tracing now records continuation payload shape, approval-related chunk flow, stream close reason, and continuation persistence outcomes without logging file contents or attachment bodies.
- Pending approval UI now survives thread switches for already-untrusted tool calls by keeping trust-resolution state keyed to the approval/tool-call instead of clearing it whenever the user briefly leaves the conversation.
- Active-thread runs now refresh the canonical persisted conversation snapshot on `run-completed`, which prevents the composer from holding onto stale pending approval state after an approval continuation has already finished.
- Denied approval synthesis now stops once a denied `tool-result` is already present in continuation history, so later unrelated approvals do not resurrect old denied tool rows.
- Partial streamed tool arguments are no longer logged as JSON parse failures during metadata reconciliation, reducing approval-path log noise while arguments are still arriving token by token.
- Same-turn duplicate tool-call reconciliation now prefers the latest terminal occurrence over the earliest pending placeholder, so denied/completed continuation messages replace stale historical `(approval needed)` rows instead of leaving the row and only updating the assistant text beneath it.
- Renderer-side trust auto-approval now re-checks that the same pending approval is still current immediately before dispatching `respondToolApproval`, which prevents fast trusted inline executions from triggering a stale approval continuation after the tool has already completed.
- Seeded approval E2E fixtures now use non-trustable tool names for thread-switch/pending-visibility assertions so local project trust config cannot auto-resolve the fixture and hide the regression.
- Coverage added:
  - renderer component and unit coverage for placeholder approval payloads
  - collector/lifecycle unit coverage for input-complete vs execution-complete
  - seeded Electron E2E coverage for reloaded placeholder-result truthfulness
  - seeded Electron E2E coverage for same-turn duplicate pending-vs-terminal replacement and thread-switch pending approval visibility
