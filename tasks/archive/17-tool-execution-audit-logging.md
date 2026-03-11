# 17 — Tool Execution Audit Logging

**Status:** Done
**Priority:** P3
**Severity:** Medium
**Depends on:** None
**Origin:** H-09

---

## Problem

`src/main/tools/define-tool.ts:72-93` — tool args are validated via Zod but never logged. Tool results are returned but not logged. When a tool fails, there's no record of what args were passed, what the tool returned, or how long it took.

## Implementation

- [ ] Add `createLogger('tools')` to `define-tool.ts`
- [ ] Before calling `config.execute()`, log: tool name, arg keys (not full values), timestamp
- [ ] After execution, log: tool name, result kind, duration in ms, whether truncated
- [ ] On failure, log: tool name, error message, duration. Log arg keys and sizes only (not full content)

## Files to Touch

- `src/main/tools/define-tool.ts` — add logging around execute

## Tests

- Unit: successful execution logs tool name, duration, result kind
- Unit: failed execution logs tool name, error, duration
- Unit: arg values are not logged (only keys)
