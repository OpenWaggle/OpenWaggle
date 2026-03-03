# Fix Tool-Call Hang After Long-Attachment Follow-up

## Goal
Prevent follow-up runs (for example, `writeFile` after an auto-pasted attachment) from getting stuck in perpetual `Writing...` when the stream emits incomplete tool-call sequences.

## Plan
- [x] Harden stream collector state tracking for incomplete tool-call lifecycles.
- [x] Ensure finalization synthesizes deterministic error tool-results for unresolved tool calls.
- [x] Distinguish stall reasons in stream processing and avoid unsafe retries for unresolved tool-result states.
- [x] Add/adjust unit tests for collector and stream processor coverage of this failure mode.
- [x] Run typecheck, lint, and targeted tests.

## Review Notes
- Implemented collector lifecycle tracking (`pending` + `awaiting-result`) and terminal synthesis of error `tool-result` parts for any unresolved tool call on finalize.
- Added processor stall-reason signaling (`stream-stall` vs `incomplete-tool-call`) plus a short grace timeout for `TOOL_CALL_END` without result.
- Updated agent loop retry policy to skip retries for incomplete tool-call stalls (avoids duplicate write retries and prolonged “hung” state).
- Implemented attachment-aware `writeFile` execution path:
  - Tool context now carries current message attachments (`name`, `extractedText`)
  - `writeFile` accepts `attachmentName` and also supports `path`-only fallback when exactly one attachment exists
  - This avoids requiring giant `writeFile.content` payloads for pasted-text attachment saves
- Prompt guidance now explicitly tells the model to use attachment-aware write paths instead of inlining full attachment text into tool args.
- Verification completed:
  - `pnpm exec vitest run -c vitest.unit.config.ts src/main/agent/stream-part-collector.unit.test.ts src/main/agent/stream-processor.unit.test.ts`
  - `pnpm exec vitest run -c vitest.unit.config.ts src/main/tools/tools/write-file.unit.test.ts src/main/tools/tools/edit-file.unit.test.ts src/main/tools/tools/edit-file.extra.unit.test.ts src/main/tools/tools/run-command.unit.test.ts src/main/tools/tools/list-files.unit.test.ts src/main/tools/tools/read-file.unit.test.ts`
  - `pnpm exec vitest run -c vitest.unit.config.ts src/main/agent/prompt-pipeline.unit.test.ts src/main/tools/tools/write-file.unit.test.ts src/main/agent/stream-part-collector.unit.test.ts src/main/agent/stream-processor.unit.test.ts`
  - `pnpm typecheck`
  - `pnpm lint`

### Follow-up Patch (same task)
- Fixed follow-up attachment saves (`"save it..."`) by resolving tool-context attachments from the latest user attachment turn when the current payload has no attachments.
  - Added `resolveToolContextAttachments` in `src/main/agent/tool-context-attachments.ts`
  - Wired `runAgent` to use this resolver when building `runWithToolContext(...)`
- Fixed false tool errors on normal stream completion when a tool call ends without a result payload:
  - `StreamPartCollector.finalizeParts({ timedOut })` now synthesizes:
    - non-error placeholder result for `TOOL_CALL_END` without result on normal completion
    - error result only when truly timed out/incomplete
- Added focused tests:
  - `src/main/agent/tool-context-attachments.unit.test.ts`
  - `src/main/agent/stream-part-collector.unit.test.ts` (normal completion vs timeout behavior)
  - `src/main/tools/tools/file-ops.integration.test.ts` (write/edit/run + attachment-context write contract)
