# Fix Approval Flow Causing "File Saved" Without Actual Write

## Problem Statement
- Users ask to save an auto-converted attachment (for example `Pasted Text 1.md`) to project root.
- UI may show `Wrote <file>` (or later `Requested writeFile <file>`) but no file appears in repository.
- Logs show `[agent-run] tool-call-start/end` but no `[tools] tool:start/tool:end` execution logs in failing runs.

## Confirmed Findings
- For conversation `492d8088-29c4-46f8-a4d1-0f176ed87c1b`, persisted assistant turn contains:
  - `tool-call` (`writeFile`)
  - no `tool-result`
  - followed by `(no response)` in a later empty run
- This means the model produced a tool call, but execution did not complete in that turn.
- In sandbox mode, this is consistent with approval-pending flows.
- Current observability is misleading:
  - `onToolCallEnd` is emitted for raw `TOOL_CALL_END` chunks even when `result` is missing.
  - `tool-call-end isError:false` can appear without any real tool execution.
- Root-cause contract mismatch:
  - Renderer continuation payload is converted to `ModelMessage[]` before main-process `chat(...)`.
  - TanStack approval continuation extracts approval decisions from **UIMessage parts** (`tool-call` part with `state: "approval-responded"` + `approval.id/approved`) before conversion.
  - With `ModelMessage[]` input, approval state can be lost; the run re-enters approval wait instead of executing `writeFile`.
  - This explains the sequence: `tool-call-start/end` (input complete) -> no `tool-result` -> later `(no response)` turn and no file on disk.
- Secondary reliability risk:
  - `ipc-connection-adapter` has a fixed fallback close path (`sendPromise.then(... setTimeout 50ms ...)`) for approval-pending runs, which can hide late/non-terminal approval events and make the UX look “finished” while execution is still unresolved.

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

### 1. Fix Continuation Payload Contract (Primary)
- [ ] Update continuation payload typing to preserve approval context:
  - `continuationMessages` supports `UIMessage[]` (or union with `ModelMessage[]` for backward compatibility).
  - Pass UI snapshots from renderer to main for approval continuation runs.
- [ ] In `ipc-connection-adapter`, stop pre-converting approval continuations to model messages.
- [ ] In `agent-loop`, pass continuation messages through directly to TanStack `chat(...)` so approval extraction from parts works.
- [ ] Keep Anthropic duplicate tool-call protection by deduping continuation tool-call IDs **without dropping approval metadata**.

### 2. Add Deterministic Stream Instrumentation
- [ ] Add temporary structured diagnostics (guarded by flag) in:
  - `src/main/agent/stream-processor.ts`
  - `src/main/ipc/agent-handler.ts`
  - `src/renderer/src/lib/ipc-connection-adapter.ts`
- [ ] Log per-run chunk timeline:
  - chunk type order
  - whether `TOOL_CALL_END.result` exists
  - whether approval custom events arrived
  - whether adapter closed due terminal chunk vs fallback timeout
- [ ] Ensure diagnostics can be disabled cleanly after fix.

### 3. Correct Execution-State Contract
- [ ] Separate concepts in runtime events:
  - tool input finalized (`TOOL_CALL_END` without result)
  - tool execution completed (`TOOL_CALL_END` with result)
- [ ] Update lifecycle telemetry so `tool-call-end` does not imply execution completion unless result exists.
- [ ] Keep `tool-result` as sole source of truth for completed execution in persisted conversation parts.

### 4. Fix Approval-Pending Stream Handoff
- [ ] Remove/replace fragile fixed-delay stream closure path in `ipc-connection-adapter`.
- [ ] Introduce explicit close semantics:
  - close on terminal chunk (`RUN_ERROR` or `RUN_FINISHED` non-`tool_calls`)
  - for approval-pending cases, close only after explicit approval-state emission is observed or via robust idle+state guard (not hardcoded 50ms race).
- [ ] If needed, emit a synthetic terminal bridge event from main process only when a run has genuinely quiesced and no further chunks are expected.

### 5. Ensure Approval Continuation Executes Real Tool
- [ ] Validate `addToolApprovalResponse` continuation payload carries the pending tool call state expected by TanStack.
- [ ] Add guardrails so approval-response runs cannot complete empty when pending write tool call exists.
- [ ] Verify `writeFile` receives attachment context on continuation runs (already partially fixed).

### 6. UI Accuracy Improvements
- [ ] Keep unresolved states clearly non-success (`Requested ...` / `Awaiting approval`) and never show completed verbs without `tool-result`.
- [ ] Ensure approval UI remains visible and actionable until continuation resolves with a tool result or explicit error.

### 7. Test Coverage
- [ ] Unit:
  - continuation payload serialization tests (`approval-responded` survives renderer -> main)
  - `ipc-connection-adapter` race tests with delayed approval custom events
  - lifecycle event classification tests (`input-finalized` vs `execution-complete`)
- [ ] Integration:
  - `writeFile` in sandbox mode with approval handshake to actual file existence assertion
  - continuation run from UI approval state executes server `writeFile` exactly once
- [ ] E2E:
  - Paste long prompt -> ask save -> click Approve -> assert file exists in repo root
  - Assert UI never shows completed write without persisted `tool-result`

## Acceptance Criteria
- Approving `writeFile` in sandbox mode always produces:
  - real `[tools] tool:start/tool:end` logs
  - persisted `tool-result`
  - file present at requested path
- Continuation payload reaching main process contains approval-resolved context (or equivalent) required by TanStack to execute approved server tools.
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
