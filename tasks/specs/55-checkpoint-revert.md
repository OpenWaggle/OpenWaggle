# 55 — Checkpoint & Revert System

**Status:** Not Started
**Priority:** P1
**Category:** Feature
**Depends on:** None
**Origin:** T3Code competitive analysis — t3code has full conversation checkpointing with diff computation, revert operations, configurable limits (2000 messages, 500 checkpoints per thread). Reference: [t3code](https://github.com/pingdotgg/t3code) checkpoint/revert with diff-based snapshots.

---

## Problem

When the OpenWaggle agent executes destructive operations (file writes, edits, shell commands), there is no way to undo those changes except:

1. **Git** — User must manually `git checkout`/`git stash` (assumes changes were in a git repo and not yet committed)
2. **Worktrees** — Sub-agents use worktree isolation (Spec 42), but the primary agent writes directly to the project directory
3. **Delete conversation** — Removes the conversation but doesn't undo file changes

t3code provides a comprehensive checkpoint system that:
- Auto-captures filesystem state before destructive tool executions
- Stores diffs (not full copies) for space efficiency
- Lets users revert to any checkpoint, restoring both files and conversation to that point
- Supports configurable limits (2000 messages, 500 checkpoints per thread)

This is a critical safety feature. When the agent makes an unwanted change, users need a one-click undo that restores both the conversation and filesystem state.

### Scope Clarification

- **Checkpoint** = filesystem-level undo (restore file contents) + conversation truncation (remove messages after the checkpoint)
- **NOT git-level reset** — Checkpoints operate on the working directory, independent of git. Git worktrees (Spec 42) remain the branch-level isolation mechanism.
- **Complementary to Spec 13 (Backup/Recovery)** — Checkpoints are user-initiated undo; backup/recovery is crash safety. Both are needed.
- **Synergistic with Spec 40 (Plan Mode)** — Plan mode shows what will happen; checkpoints provide a safety net if execution goes wrong. Future: auto-checkpoint on plan approval.

## Implementation

### Phase 1: Checkpoint Data Model & Types

- [ ] Create `src/shared/types/checkpoint.ts`:
  ```typescript
  import { Brand } from './brand'

  type CheckpointId = Brand<string, 'CheckpointId'>
  function CheckpointId(id: string): CheckpointId

  interface FileDiff {
    filePath: string
    type: 'created' | 'modified' | 'deleted'
    beforeContent: string | null   // null for created files
    afterContent: string | null    // null for deleted files
    // Unified diff patch for modified files (space-efficient)
    patch: string | null           // null for created/deleted (full content stored instead)
  }

  interface Checkpoint {
    id: CheckpointId
    conversationId: ConversationId
    messageIndex: number           // index of the last message BEFORE this checkpoint
    toolCallId: ToolCallId         // the tool call that triggered this checkpoint
    timestamp: number
    label: string                  // human-readable, e.g., "Before writeFile: src/main/index.ts"
    diffs: FileDiff[]              // files affected by this tool execution
    projectPath: string            // project root at checkpoint time
  }

  interface CheckpointSummary {
    id: CheckpointId
    messageIndex: number
    timestamp: number
    label: string
    fileCount: number              // number of files in diffs
    toolCallId: ToolCallId
  }
  ```
- [ ] Create Zod schemas for checkpoint persistence in `src/shared/schemas/`:
  - `fileDiffSchema`, `checkpointSchema` for runtime validation on load
- [ ] Add `CheckpointId` to branded types in `src/shared/types/brand.ts`

### Phase 2: Checkpoint Capture (Main Process)

- [ ] Create `src/main/store/checkpoints.ts`:
  - **Storage:** `{userData}/conversations/{conversationId}/checkpoints/{checkpointId}.json`
  - Directory created lazily on first checkpoint for a conversation
  - `saveCheckpoint(checkpoint: Checkpoint): Promise<void>` — atomic JSON write
  - `listCheckpoints(conversationId: ConversationId): Promise<CheckpointSummary[]>` — read all checkpoint files, return summaries sorted by timestamp
  - `getCheckpoint(conversationId: ConversationId, checkpointId: CheckpointId): Promise<Checkpoint | null>`
  - `deleteCheckpoint(conversationId: ConversationId, checkpointId: CheckpointId): Promise<void>`
  - `pruneCheckpoints(conversationId: ConversationId, maxCount: number): Promise<void>` — delete oldest beyond limit
  - `deleteAllCheckpoints(conversationId: ConversationId): Promise<void>` — cleanup when conversation deleted

- [ ] Create `src/main/agent/checkpoint-capture.ts`:
  - **Before tool execution hook:**
    ```typescript
    async function captureCheckpoint(
      conversationId: ConversationId,
      toolCallId: ToolCallId,
      toolName: string,
      toolArgs: unknown,
      projectPath: string,
      messageIndex: number,
    ): Promise<CheckpointId>
    ```
  - For `writeFile` tool: read current file content (or note "file doesn't exist yet")
  - For `editFile` tool: read current file content
  - For `runCommand` tool: cannot predict file changes — capture state of common project files (package.json, key config files) OR skip checkpointing for commands (configurable)
  - Generate `FileDiff` with `beforeContent` for each file about to be modified
  - **After tool execution hook:**
    ```typescript
    async function finalizeCheckpoint(
      checkpointId: CheckpointId,
      projectPath: string,
    ): Promise<void>
    ```
  - Read file contents after tool execution
  - Compute unified diff patch for modified files (using `diff` package: `createPatch()`)
  - Store `afterContent` for created files, `beforeContent` for deleted files
  - Save finalized checkpoint

- [ ] Integrate capture hooks into tool execution flow:
  - In `src/main/tools/define-tool.ts` or at the agent loop level where tools are executed
  - Before calling `tool.execute()`: call `captureCheckpoint()` if tool has `needsApproval: true` (all destructive tools)
  - After `tool.execute()` returns: call `finalizeCheckpoint()`
  - Handle errors: if tool execution fails, still save checkpoint (user might want to see what state was before the failed attempt)

### Phase 3: Revert Operation

- [ ] Create `src/main/agent/checkpoint-revert.ts`:
  ```typescript
  async function revertToCheckpoint(
    conversationId: ConversationId,
    checkpointId: CheckpointId,
  ): Promise<{ restoredFiles: string[]; removedMessages: number }>
  ```
  - **Filesystem restoration:**
    - For `modified` files: apply inverse patch (or write `beforeContent` directly)
    - For `created` files: delete the file (it didn't exist before)
    - For `deleted` files: write `beforeContent` to restore the file
    - Verify file paths are within `projectPath` (security: prevent path traversal)
  - **Conversation truncation:**
    - Load conversation from persistence
    - Remove all messages with index > `checkpoint.messageIndex`
    - Persist truncated conversation
  - **Cascade checkpoint cleanup:**
    - Delete all checkpoints newer than the reverted checkpoint
    - The reverted checkpoint itself is kept (can revert to it again)
  - Return summary of what was restored

- [ ] Add IPC channels to `src/shared/types/ipc.ts`:
  ```typescript
  'checkpoint:list': {
    args: [ConversationId]
    return: CheckpointSummary[]
  }
  'checkpoint:get': {
    args: [ConversationId, CheckpointId]
    return: Checkpoint | null
  }
  'checkpoint:revert': {
    args: [ConversationId, CheckpointId]
    return: { restoredFiles: string[]; removedMessages: number }
  }
  'checkpoint:delete': {
    args: [ConversationId, CheckpointId]
    return: void
  }
  ```

- [ ] Implement `src/main/ipc/checkpoint-handler.ts`:
  - Register all 4 IPC handlers
  - `checkpoint:revert` should cancel any active agent run first (safety)
  - Emit a `'checkpoint:reverted'` event to renderer after successful revert

- [ ] Add `'checkpoint:reverted'` to `IpcEventChannelMap`:
  ```typescript
  'checkpoint:reverted': {
    payload: {
      conversationId: ConversationId
      checkpointId: CheckpointId
      restoredFiles: string[]
      removedMessages: number
    }
  }
  ```

### Phase 4: Renderer UI

- [ ] Create `src/renderer/src/components/chat/CheckpointMarker.tsx`:
  - Inline marker rendered between messages in the chat transcript
  - Shows: checkpoint icon, label (e.g., "Checkpoint: writeFile src/main/index.ts"), timestamp, file count
  - "Revert to here" button (subtle, appears on hover)
  - Collapsed by default to avoid clutter; expandable to show file list
  - Visual style: horizontal rule with centered badge, muted colors

- [ ] Create `src/renderer/src/components/chat/CheckpointRevertDialog.tsx`:
  - Confirmation dialog triggered by "Revert to here" button
  - Shows:
    - Files that will be restored (with type badges: modified/created/deleted)
    - Number of messages that will be removed
    - Warning: "This will undo all changes after this point"
  - Confirm/Cancel buttons
  - Loading state during revert operation

- [ ] Integrate `CheckpointMarker` into message list:
  - After messages that triggered checkpoint-able tool calls
  - Use `checkpoint:list` IPC to fetch checkpoints for current conversation
  - Position markers based on `messageIndex` alignment

- [ ] Add checkpoint count to conversation header:
  - Small badge or indicator showing number of checkpoints available
  - Clicking opens checkpoint timeline/list overlay

- [ ] Handle `'checkpoint:reverted'` event in renderer:
  - Reload conversation messages (truncated)
  - Show success toast: "Reverted to checkpoint. Restored N files."
  - Refresh chat scroll position to bottom

### Phase 5: Configuration & Limits

- [ ] Add checkpoint settings to app settings:
  - `checkpoints.enabled`: boolean (default: true)
  - `checkpoints.maxPerConversation`: number (default: 200)
  - `checkpoints.autoCheckpointCommands`: boolean (default: false — whether to checkpoint before `runCommand`)
  - `checkpoints.maxFileSizeBytes`: number (default: 1MB — skip files larger than this)
- [ ] Implement checkpoint pruning:
  - After saving a new checkpoint, check count vs limit
  - Prune oldest checkpoints beyond limit
  - Never prune the most recent 5 checkpoints (safety)
- [ ] Wire conversation deletion to checkpoint cleanup:
  - When a conversation is deleted, also delete its checkpoint directory
  - Add to existing conversation deletion handler

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/shared/types/checkpoint.ts` | Checkpoint type definitions |
| `src/shared/schemas/checkpoint.ts` | Zod validation schemas |
| `src/main/store/checkpoints.ts` | Checkpoint persistence (read/write JSON) |
| `src/main/agent/checkpoint-capture.ts` | Pre/post tool execution capture logic |
| `src/main/agent/checkpoint-revert.ts` | Revert operation (filesystem + conversation) |
| `src/main/ipc/checkpoint-handler.ts` | IPC handlers for checkpoint operations |
| `src/renderer/src/components/chat/CheckpointMarker.tsx` | Inline checkpoint marker in transcript |
| `src/renderer/src/components/chat/CheckpointRevertDialog.tsx` | Revert confirmation dialog |

## Files to Modify

| File | Change |
|------|--------|
| `src/shared/types/brand.ts` | Add `CheckpointId` branded type |
| `src/shared/types/ipc.ts` | Add 4 checkpoint IPC channels + 1 event channel |
| `src/preload/api.ts` | Add checkpoint API methods |
| `src/main/index.ts` | Register checkpoint IPC handlers |
| `src/main/tools/define-tool.ts` (or agent loop) | Add pre/post execution checkpoint hooks |
| `src/main/store/conversations.ts` | Wire checkpoint cleanup to conversation deletion |
| `src/renderer/src/components/chat/ChatPanel.tsx` (or message list) | Insert CheckpointMarker components |

## Cross-References

- **Spec 13 (Backup/Recovery)** — Checkpoint = user-initiated undo. Backup = crash safety. Complementary, not overlapping.
- **Spec 40 (Plan Mode)** — Synergistic: plan mode shows intent, checkpoint provides safety net. Future: auto-checkpoint on plan approval.
- **Spec 42 (Git Worktrees)** — Orthogonal: worktrees = branch-level isolation. Checkpoints = within-branch file-level undo.
- **Spec 56 (SQLite)** — If SQLite ships first, checkpoints could be stored in a `checkpoints` table instead of JSON files.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance: reading files before every tool execution | Medium | Skip files > 1MB; async I/O; only checkpoint `needsApproval` tools |
| Disk space: many checkpoints with large diffs | Medium | LRU pruning; store diffs not full content; configurable limit |
| Revert safety: inverse patch may fail on modified files | Medium | Fall back to writing `beforeContent` directly if patch apply fails |
| Path traversal in restore | High | Validate all file paths are within `projectPath` before write |
| Race condition: revert during active agent run | Medium | Cancel active run before reverting; mutex on revert operation |
| Large binary files in checkpoints | Low | Skip non-text files (detect via file extension or buffer inspection) |

## Definition of Done

1. Checkpoints auto-created before `writeFile` and `editFile` tool execution
2. `runCommand` checkpointing configurable (default: off)
3. Checkpoint markers visible in chat transcript with hover-reveal "Revert" button
4. Revert operation restores files and truncates conversation correctly
5. Confirmation dialog shows affected files before revert
6. Checkpoint count configurable with auto-pruning
7. Conversation deletion cleans up checkpoints
8. No path traversal vulnerabilities in restore operation
9. Performance: checkpoint capture adds <50ms to tool execution for typical files

## Testing Strategy

- **Unit tests:** `checkpoint-capture.unit.test.ts`:
  - Captures file state before writeFile (existing file, new file)
  - Generates correct unified diff patches
  - Skips files above size limit
  - Handles missing files gracefully
- **Unit tests:** `checkpoint-revert.unit.test.ts`:
  - Restores modified file from diff
  - Deletes file that was created after checkpoint
  - Recreates file that was deleted after checkpoint
  - Truncates conversation correctly
  - Rejects paths outside project directory
- **Unit tests:** `checkpoints.unit.test.ts` (persistence):
  - Save and load checkpoint round-trip
  - List returns sorted summaries
  - Prune keeps newest, removes oldest
- **Integration tests:** `checkpoint-flow.integration.test.ts`:
  - Full flow: write file → checkpoint created → modify further → revert → files restored
- **Component tests:** `CheckpointMarker.component.test.tsx`:
  - Renders label and file count
  - Shows revert button on hover
  - Opens confirmation dialog on revert click
