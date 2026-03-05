# 46 — Approval Continuation Contract + Trusted Approval UX

## Goal
Eliminate Anthropic continuation failures caused by orphaned `tool_result` payloads and remove approval-banner flashing for already-trusted tool calls.

## Plan
- [x] Prevent synthetic unresolved `tool-result` creation for normal (non-timeout) `TOOL_CALL_END` events without a result payload.
- [x] Harden continuation normalization to drop orphan `tool` messages that are not directly paired to a preceding assistant `tool_call`.
- [x] Suppress approval-banner rendering while trust checks are in-flight for trustable tools.
- [x] Run full verification (`pnpm typecheck`, `pnpm check`, `pnpm test`) and React Doctor.

## Changes
- `src/main/agent/stream-part-collector.ts`
  - Preserve unresolved tool calls on normal completion when `TOOL_CALL_END` has no `result`, instead of synthesizing error `tool-result` blocks.
- `src/main/agent/stream-part-collector.unit.test.ts`
  - Updated expectations to keep unresolved tool calls on non-timeout completion.
- `src/main/agent/continuation-normalizer.ts`
  - Added pairing enforcement that drops orphan `tool` results lacking a matching tool call in the immediately preceding assistant message.
- `src/main/agent/continuation-normalizer.unit.test.ts`
  - Added orphan tool-result regression coverage.
- `src/renderer/src/components/chat/use-chat-panel-controller.ts`
  - Added trust-check state machine (`checking/trusted/untrusted`) and hidden-pending behavior to avoid trust-banner flash for pre-approved tool calls.
- `src/renderer/src/components/chat/pending-tool-interactions.ts`
  - `findPendingApproval` now selects the newest unresolved approval-requested tool call (reverse scan + completed-tool filtering), preventing stale approval requests from blocking later tool approvals in the same thread.
  - Trustable unresolved tool-call fallback now also handles state-less tool parts when arguments are complete JSON, preventing silent continuation stalls when upstream tool-call updates drop `state` metadata.
- `src/renderer/src/components/chat/pending-tool-interactions.unit.test.ts`
  - Added regression coverage for stale-first-approval selection plus state-less trustable unresolved tool calls.
- `patches/@tanstack__ai@0.6.1.patch`
  - Added `message-updaters.ts` hunk to preserve existing `approval`/`output` fields on tool-call updates, preventing approval metadata loss during stream updates.
  - Added matching `dist/esm` hunks (`messages.js`, `stream/message-updaters.js`, `tools/tool-calls.js`) so runtime behavior matches source-level patch intent after reinstall.
- `src/renderer/src/lib/ipc-connection-adapter.ts`
  - Increased `runCompleted` close grace from `50ms` to `300ms` to reduce late terminal/text chunk truncation risk when run-completed races ahead of final chunks.
- `src/renderer/src/lib/ipc-connection-adapter.unit.test.ts`
  - Added delayed-terminal regression coverage to assert terminal chunks arriving shortly after `runCompleted` are still emitted.

## Verification
- `pnpm typecheck` ✅
- `pnpm check` ✅
- `pnpm test` ✅
- `pnpm test:e2e` ✅
- `npx -y react-doctor@latest . --verbose --diff main` ✅ (100/100)

## Review Notes
- This fix is intentionally contract-first: malformed/orphan continuation tool result history is now normalized before provider submission.
- Approval UX now avoids noisy transient UI for pre-trusted commands, while still surfacing approval controls for untrusted calls.

## Follow-up Improvements (Documented, Non-Trivial)
- Add an explicit post-tool completion telemetry marker (main + renderer) to distinguish “model chose not to send final text” from “late final text was dropped after close.”
- Add a deterministic end-to-end regression that simulates multi-step server-tool iterations with late final text to protect against future close-timing regressions.
