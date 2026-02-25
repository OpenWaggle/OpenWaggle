# 15 — Preserve Error Stack Traces Across IPC

**Status:** Planned
**Priority:** P3
**Severity:** Medium
**Depends on:** None
**Origin:** H-10

---

## Problem

`src/main/utils/stream-bridge.ts:16` — when a `RUN_ERROR` stream chunk is serialized for IPC, the Error object is destructured to `{ message: chunk.error.message }`. Stack traces, error names, and custom properties are lost. The renderer only sees a flat string.

## Implementation

- [ ] Change the serialization to include `name` and `stack`:
  ```typescript
  const serializable = chunk.type === 'RUN_ERROR'
    ? { ...chunk, error: { message: chunk.error.message, name: chunk.error.name, stack: chunk.error.stack } }
    : chunk
  ```
- [ ] In the renderer error display, show the stack trace in an expandable section (collapsed by default)

## Files to Touch

- `src/main/utils/stream-bridge.ts` — expand error serialization
- `src/renderer/src/components/chat/ChatErrorDisplay.tsx` — optionally show stack

## Tests

- Unit: RUN_ERROR serialization preserves name and stack
- Component: stack trace renders in expandable section
