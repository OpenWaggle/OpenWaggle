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

---

## Phase 2 — Learned Approvals

**Status**: Planned

### Problem

The current approval UX is binary: paranoid (approve everything) or yolo (full-access mode). Heavy agent users rubber-stamp approvals because the friction is too high. Approving `writeFile` to `.tsx` files for the 50th time teaches the user nothing — it just slows them down.

### Design

Track approval patterns and offer progressive trust:

1. **Pattern tracking**: Record every approval decision with context:
   - Tool name (`writeFile`, `editFile`, `runCommand`)
   - File path pattern (e.g., `src/renderer/**/*.tsx`)
   - Command pattern (e.g., `pnpm test*`)
   - Decision (approved / denied)
   - Count (how many times this pattern was approved)

2. **Auto-approve suggestion**: After N approvals of the same pattern (default: 5), offer:
   > "You've approved writeFile to `src/renderer/**/*.tsx` 5 times. Auto-approve this pattern?"
   > [Yes for this session] [Yes always] [No, keep asking]

3. **Approval rules**: Persisted rules that auto-approve matching patterns:
   ```json
   {
     "rules": [
       { "tool": "writeFile", "pathPattern": "src/renderer/**/*.tsx", "scope": "always" },
       { "tool": "runCommand", "commandPattern": "pnpm test*", "scope": "session" },
       { "tool": "editFile", "pathPattern": "src/**", "scope": "always" }
     ]
   }
   ```

4. **Scope levels**:
   - `session` — auto-approve for this conversation only
   - `project` — auto-approve for this project (stored in `.openwaggle/approvals.json`)
   - `always` — auto-approve globally (stored in `electron-store`)

5. **Never auto-approve**: Some patterns stay manual regardless:
   - `runCommand` with destructive patterns (`rm`, `git push`, `git reset`)
   - `writeFile` to config files (`.env`, `package.json`, `tsconfig.json`)
   - Any tool call the user has denied before

### Implementation

- [ ] Create `src/main/agent/approval-tracker.ts`
  - Track approval decisions with tool + path/command pattern
  - Count approvals per pattern
  - After threshold, emit suggestion to renderer
- [ ] Create `src/main/agent/approval-rules.ts`
  - Load rules from `electron-store` (global) and `.openwaggle/approvals.json` (project)
  - Match incoming tool calls against rules
  - Auto-approve if rule matches, otherwise fall through to manual approval
- [ ] Add "Auto-approve this pattern?" UI in approval banner
  - Three options: session / always / no
  - Shows the pattern that would be auto-approved
- [ ] Add approval rules editor in settings
  - List of active rules with delete option
  - "Reset all rules" button
- [ ] Blocklist: patterns that never auto-approve
  - Destructive commands
  - Config/env files
  - Previously denied patterns

### Files to Modify

- `src/main/tools/define-tool.ts` — check approval rules before prompting
- `src/main/agent/approval-tracker.ts` — new: pattern tracking
- `src/main/agent/approval-rules.ts` — new: rule matching
- `src/renderer/src/components/chat/ApprovalBanner.tsx` — auto-approve suggestion UI
- `src/renderer/src/stores/settings-store.ts` — approval rules state
