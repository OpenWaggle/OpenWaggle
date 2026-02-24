# Fix Error Messages

**Priority:** 3 — Usability
**Depends on:** Nothing
**Blocks:** Nothing

---

## Current State (2026-02-24) — COMPLETED

All gaps implemented and tested. See Review section at bottom.

## Previous State

The core error classification pipeline is **done end-to-end**:
- `src/shared/types/errors.ts` — `AgentErrorCode` enum (8 codes), `AgentErrorInfo` interface, `classifyErrorMessage()` pattern matcher, `ERROR_CODE_META` lookup table
- `src/main/agent/error-classifier.ts` — `classifyAgentError()` wraps unknown → message → classify
- `src/main/ipc/agent-handler.ts:169` — Catches all `runAgent()` errors, classifies, emits structured `RUN_ERROR` with `code` + `userMessage`
- `src/main/utils/stream-bridge.ts:15-20` — Serializes `RUN_ERROR` with `code` preserved over IPC
- `src/renderer/src/lib/ipc-connection-adapter.ts:193-199` — Renderer intercepts `RUN_ERROR`, resolves to `AgentErrorInfo`
- `src/renderer/src/components/chat/ChatErrorDisplay.tsx` — Renders copy-to-clipboard, suggestion text, expandable stack trace, Open Settings for auth errors, retry for retryable errors
- `src/main/tools/tools/run-command.ts:77-83` — Timeout error is actionable
- `src/main/tools/tools/edit-file.ts:22-30` — Not-found / multiple-match errors have suggestions

## Remaining Gaps

### Gap 3a — edit-file: include search context in error

**File:** `src/main/tools/tools/edit-file.ts:22-25`
**Current:** `"String not found in {path}. The old string must match exactly..."`
**Spec:** Include the first 100 chars of `oldString` and the file's line count so the agent can self-correct faster.

**Change:**
```typescript
const lineCount = content.split('\n').length
const preview = args.oldString.length > 100
  ? `${args.oldString.slice(0, 100)}...`
  : args.oldString
throw new Error(
  `String not found in ${args.path} (${lineCount} lines). ` +
  `Searched for: "${preview}". ` +
  `The old string must match exactly including whitespace and line breaks. ` +
  `Read the file first to verify the exact content.`
)
```

### Gap 3b — run-command: user-friendly dangerous command message

**File:** `src/main/tools/tools/run-command.ts:23-30`
**Current:** `"Command blocked: matches dangerous pattern ${pattern.source}"` — shows raw regex
**Spec:** User-friendly text with suggestion.

**Change:** Add a human-readable description map for each pattern:
```typescript
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+-rf\s+\//, description: 'recursive delete from root (/)' },
  { pattern: /rm\s+-rf\s+~/, description: 'recursive delete from home (~)' },
  { pattern: /rm\s+-rf\s+\$HOME/, description: 'recursive delete from $HOME' },
  { pattern: /curl\s.*\|\s*bash/, description: 'piping remote script to bash' },
  { pattern: /wget\s.*\|\s*sh/, description: 'piping remote script to sh' },
  { pattern: /chmod\s+777/, description: 'setting world-writable permissions' },
  { pattern: />\s*\/dev\/sda/, description: 'writing directly to disk device' },
  { pattern: /dd\s+if=/, description: 'raw disk copy (dd)' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, description: 'fork bomb' },
]
```
Return message: `"Command blocked for safety: {description}. Rephrase the command to avoid this pattern."`

### Gap 3c — Orchestration planner JSON failure: visible warning

**File:** `src/main/orchestration/service.ts:548-563`
**Current:** Silently returns `{ tasks: [] }` when planner JSON extraction fails, which triggers classic fallback with no user visibility.
**Spec:** Emit a visible warning to the stream so the user knows orchestration was attempted but failed.

**Change:** The outer catch at line 385 already appends a fallback message when orchestration throws. The issue is that `modelJson()` swallows the failure by returning `{ tasks: [] }` instead of throwing. When the planner returns garbage JSON, `{ tasks: [] }` causes orchestration to proceed with zero tasks and synthesize an empty result.

Fix: throw from `modelJson()` on extraction failure so it falls through to the catch at line 385, which already emits the fallback warning.

```typescript
// In modelJson(), replace lines 548-563:
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err)
  logger.warn('modelJson extraction failure', { reason, rawLength: text.length })
  throw new Error(`Planner output could not be parsed as JSON: ${reason}`)
}
```

This way the existing fallback path (line 385-401) handles it: `"Orchestration encountered an issue: Planner output could not be parsed as JSON: ... Falling back to direct execution."`

### Gap 3d — Orchestration task failure: include task title

**File:** `src/main/orchestration/service.ts:349-357`
**Current:** `failedTask?.error ?? 'orchestration run failed'` — shows error text but not the task title.
**Spec:** Include the task title so the user knows which sub-task failed.

**Change:** The `taskTitles` map is already populated at line 184-194. The failed task lookup just needs to include the title:
```typescript
const failedTaskRecord = orchestrationResult.run?.taskOrder
  .map((tid) => orchestrationResult.run?.tasks[String(tid)])
  .find((task) => task?.status === 'failed')
const failedTaskId = failedTaskRecord ? String((failedTaskRecord as { id?: unknown }).id ?? '') : undefined
const failedTitle = failedTaskId ? taskTitles.get(failedTaskId) : undefined
const failureMessage = failedTitle
  ? `Task "${failedTitle}" failed: ${failedTaskRecord?.error ?? 'unknown error'}`
  : failedTaskRecord?.error ?? 'orchestration run failed'
```

### Gap 3e — File logging + "Open Logs" button

**Files to create/modify:**

#### 3e-i. Add file logging to `src/main/logger.ts`

Add a file writer that appends log lines to a rotating file in `app.getPath('logs')`:
- Lazy-initialize on first log call (avoid import-time `app` access)
- Write to `openhive.log` with day-based rotation (keep last 3 days)
- All log levels (debug, info, warn, error) write to file
- Expose `getLogFilePath(): string` for IPC

~40 LOC addition.

#### 3e-ii. Add IPC channel `shell:open-path`

**File:** `src/shared/types/ipc.ts` — Add to `IpcInvokeChannelMap`:
```typescript
'shell:open-path': {
  args: [filePath: string]
  return: void
}
'app:get-logs-path': {
  args: []
  return: string
}
```

#### 3e-iii. Create `src/main/ipc/shell-handler.ts`

New handler file (~15 LOC):
```typescript
import { app, shell } from 'electron'
import { typedHandle } from './ipc-utils'

export function registerShellHandlers(): void {
  typedHandle('shell:open-path', (_event, filePath: string) => {
    shell.openPath(filePath)
  })
  typedHandle('app:get-logs-path', () => {
    return app.getPath('logs')
  })
}
```

Register in `src/main/index.ts` alongside other handlers.

#### 3e-iv. Add to preload API

**File:** `src/preload/api.ts` — Add to `OpenHiveApi`:
```typescript
openPath(filePath: string): Promise<void>
getLogsPath(): Promise<string>
```

**File:** `src/shared/types/ipc.ts` — Add to `OpenHiveApi` interface:
```typescript
// Shell
openPath(filePath: string): Promise<void>
getLogsPath(): Promise<string>
```

#### 3e-v. Add "Open Logs" button to `ChatErrorDisplay.tsx`

When `info.code !== 'api-key-invalid'` (non-auth errors), show an "Open Logs" button that calls `window.api.getLogsPath()` then `window.api.openPath(path)`.

## Files to Touch

| File | Change |
|------|--------|
| `src/main/tools/tools/edit-file.ts` | Include search context in error (3a) |
| `src/main/tools/tools/run-command.ts` | Human-readable dangerous command message (3b) |
| `src/main/orchestration/service.ts` | Throw on JSON extraction failure (3c), task title in failure (3d) |
| `src/main/logger.ts` | Add file logging + `getLogFilePath()` (3e-i) |
| `src/shared/types/ipc.ts` | Add `shell:open-path`, `app:get-logs-path` channels + API (3e-ii, 3e-iv) |
| `src/main/ipc/shell-handler.ts` | **New** — shell/app handlers (3e-iii) |
| `src/main/index.ts` | Register shell handlers (3e-iii) |
| `src/preload/api.ts` | Add `openPath()`, `getLogsPath()` (3e-iv) |
| `src/renderer/src/components/chat/ChatErrorDisplay.tsx` | Add "Open Logs" button (3e-v) |

## Tests

- Unit: edit-file error includes line count and preview
- Unit: run-command dangerous command returns human-readable message
- Unit: orchestration `modelJson()` throws on extraction failure
- Unit: orchestration failure message includes task title
- Unit: logger writes to file (mock `fs.appendFile`)
- Unit: shell handler calls `shell.openPath`

## Implementation Order

1. **3a + 3b** — Tool error messages (standalone, no cross-file deps)
2. **3c + 3d** — Orchestration error improvements (both in service.ts)
3. **3e-i** — File logging
4. **3e-ii + 3e-iii + 3e-iv** — IPC plumbing for shell/logs
5. **3e-v** — "Open Logs" button in ChatErrorDisplay
6. Tests

## Review

All 5 gaps closed:
- **3a**: edit-file error now includes line count and first 100 chars of oldString
- **3b**: run-command blocked message shows human-readable description instead of raw regex
- **3c**: modelJson() throws on extraction failure → visible fallback message via existing catch
- **3d**: orchestration task failure message includes task title from taskTitles map
- **3e**: File logger writes to `{logs}/openhive-{date}.log` with 3-day pruning; `shell:open-path` and `app:get-logs-path` IPC channels; "Open Logs" button in ChatErrorDisplay for non-auth errors

Tests added:
- `src/main/tools/tools/edit-file.unit.test.ts` (3 tests)
- `src/main/tools/tools/run-command.unit.test.ts` (4 tests)
- `src/main/orchestration/service.unit.test.ts` (+2 tests: JSON failure triggers fallback, task title in error)
- `src/main/logger.unit.test.ts` (3 tests)
- `src/main/ipc/shell-handler.unit.test.ts` (3 tests)

Verification: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm test` all 519 tests pass.
