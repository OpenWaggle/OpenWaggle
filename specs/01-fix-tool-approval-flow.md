# Fix Tool Approval Flow

**Priority:** 1 — Trust
**Depends on:** Nothing
**Blocks:** Task 2 (orchestration executor permissions)

---

## Problem

The approval system is incomplete end-to-end. The renderer has `ApprovalBanner.tsx` UI and the tool system has `needsApproval` flags, but the stream-level handshake between main and renderer is not fully wired. In sandbox mode, tools simply throw (`define-tool.ts:76` — `throw new Error('Tool "${config.name}" is blocked in sandbox mode')`). There's no middle ground where the user can approve a specific tool call mid-stream.

## What Exists

- `src/main/tools/define-tool.ts:61,68` — `needsApproval` field on tool definition, passed to TanStack AI's `toolDefinition()`
- `src/renderer/src/components/chat/ApprovalBanner.tsx` — Full approve/deny UI component with loading states, tool summary display
- `src/renderer/src/lib/tool-display.ts` — Tool config with icons and display names for approval context
- `src/renderer/src/lib/tool-args.ts` — Arg parsing for human-readable approval summaries
- TanStack AI's `chat()` respects `needsApproval` on the adapter level, but the stream chunk types for approval-pending aren't being caught or forwarded

## What's Broken

- `define-tool.ts:75-77` — Sandbox mode does a binary block/allow. No "ask user" path.
- The agent loop (`agent-loop.ts:267-287`) processes stream chunks but doesn't handle an approval-pending chunk type. It only handles `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_*`, and `RUN_ERROR`.
- `ApprovalBanner.tsx:12` takes an `onApprovalResponse` callback, but nowhere in the codebase is this connected to the IPC layer to send the approval decision back to the main process.
- No IPC channel exists in `src/shared/types/ipc.ts` for `tool:approval-response`.

## Implementation

1. Add a new IPC invoke channel: `'tool:approval-response'` in `IpcInvokeChannelMap` → `{ approvalId: string, approved: boolean } => void`
2. Add a new IPC event channel: `'tool:approval-request'` in `IpcEventChannelMap` → `{ approvalId: string, toolName: string, toolArgs: string, conversationId: string }`
3. In `define-tool.ts`, replace the sandbox throw with an approval flow:
   - When `executionMode === 'sandbox' && needsApproval`, emit an approval request via IPC and `await` a Promise that resolves when the renderer responds
   - Use a `Map<string, { resolve, reject }>` keyed by `approvalId` to track pending approvals
4. In the renderer, listen for `tool:approval-request` events and show `ApprovalBanner`
5. Wire `ApprovalBanner.onApprovalResponse` to invoke `'tool:approval-response'` IPC channel
6. Handle denial gracefully — return a tool error result, don't throw (so the agent can recover)

## Files to Touch

- `src/shared/types/ipc.ts` — add channels
- `src/main/tools/define-tool.ts` — approval flow logic
- `src/main/ipc/handlers.ts` — register approval response handler
- `src/preload/api.ts` — expose approval methods
- `src/renderer/src/lib/ipc-connection-adapter.ts` — listen for approval events
- `src/renderer/src/components/chat/ApprovalBanner.tsx` — wire to IPC
- `src/renderer/src/stores/chat-store.ts` — track pending approval state

## Tests

- Unit test: approval flow in `define-tool.ts` (mock IPC, verify await/resolve)
- Integration test: approval banner renders on event, calls back correctly
- E2E: send message that triggers `writeFile` in sandbox → approval banner appears → approve → file written
