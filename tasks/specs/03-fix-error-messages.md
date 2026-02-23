# Fix Error Messages

**Priority:** 3 — Usability
**Depends on:** Nothing
**Blocks:** Nothing

---

## Problem

Errors throughout the system are terse and unhelpful. Users can't diagnose what went wrong or how to fix it.

## Specific Instances Found

### 3a. Tool errors are generic

- `define-tool.ts:76` — `'Tool "${config.name}" is blocked in sandbox mode'` — doesn't tell user what to do (switch to full-access? approve the tool?)
- `run-command.ts` — Command timeout after 30s just rejects the promise. Agent sees "Error" but user sees nothing actionable.
- `edit-file.ts` — When the old string isn't found, error says "not found in file" but doesn't suggest checking for whitespace differences or showing what the file actually contains near the expected location.

### 3b. Agent loop errors crash silently

- `agent-loop.ts:315-325` — Catch block throws `new Error('aborted')` for abort, rethrows everything else. Network errors (API key invalid, rate limit, provider down) bubble up as raw exceptions.
- No structured error type — just `Error` with a string message.

### 3c. Orchestration errors are swallowed

- `service.ts:389-401` — Catch-all logs `'orchestration failed, falling back'` but the user only sees the fallback result, not why orchestration failed.
- `service.ts:543-546` — `modelJson` extraction failure returns `{ tasks: [] }` silently. Planner produced garbage JSON and the system proceeds with zero tasks.
- `service.ts:356` — Failed task error is `failedTask?.error ?? 'orchestration run failed'` — generic.

### 3d. Renderer error display is minimal

- `ChatErrorDisplay.tsx` shows error + retry button but no copy-to-clipboard, no log path, no suggestion.

## Implementation

1. **Create a structured error type** in `src/shared/types/errors.ts`:
   ```ts
   interface AgentError {
     code: string
     message: string
     userMessage: string
     suggestion?: string
     retryable: boolean
   }
   ```
   Codes: `'api-key-invalid'`, `'rate-limited'`, `'network-error'`, `'tool-blocked'`, `'tool-timeout'`, `'provider-down'`, `'orchestration-planner-failed'`, etc.

2. **Wrap provider errors** in `agent-loop.ts` catch block — detect common HTTP status codes (401 → api-key-invalid, 429 → rate-limited, 5xx → provider-down) and map to `AgentError` with helpful `userMessage` and `suggestion`.

3. **Improve tool error messages:**
   - Sandbox block: `"writeFile is blocked in sandbox mode. Switch to Full Access in the status bar, or approve individual tool calls."`
   - Command timeout: `"Command timed out after 30s: 'pnpm build'. Try a shorter command or increase timeout."`
   - Edit not found: Include the first 100 chars of `oldString` and the file's line count for context.

4. **Surface orchestration failures** in the stream:
   - When planner JSON extraction fails, append a visible warning: `"Orchestration planning failed — falling back to direct agent."`
   - When a task fails, include the task title and error, not just the generic message.

5. **Enhance ChatErrorDisplay.tsx:**
   - Add copy-to-clipboard button for error message
   - Show suggestion text from `AgentError.suggestion`
   - Show "Open logs" link if error is non-trivial (link to Electron's log directory)

## Files to Touch

- `src/shared/types/errors.ts` — new file, structured error type
- `src/main/agent/agent-loop.ts` — wrap catch block with error classification
- `src/main/tools/define-tool.ts` — improve tool error messages
- `src/main/tools/tools/run-command.ts` — timeout error message
- `src/main/tools/tools/edit-file.ts` — not-found error message
- `src/main/orchestration/service.ts` — surface planner/task failures
- `src/renderer/src/components/chat/ChatErrorDisplay.tsx` — copy button, suggestions
- `src/shared/types/ipc.ts` — if error events need a new shape
