# 16 — Extract Duplicated Utilities

**Status:** Planned
**Priority:** P3
**Severity:** Medium
**Depends on:** None
**Origin:** H-08

---

## Problem

The window broadcast pattern is duplicated in `src/main/utils/stream-bridge.ts` and `src/main/ipc/terminal-handler.ts`. Similarly, `isPathInside()` exists in `src/main/tools/define-tool.ts` and is reimplemented with different logic in `src/main/ipc/attachments-handler.ts`.

## Implementation

- [ ] Extract `broadcastToWindows(channel, payload)` into `src/main/utils/ipc-broadcast.ts`. Replace all inline loops.
- [ ] Extract `isPathInside()` into `src/shared/utils/paths.ts` (or `src/main/utils/paths.ts` if Node-only). Remove duplicates.
- [ ] Add unit tests for both utilities.

## Files to Touch

- `src/main/utils/ipc-broadcast.ts` (new)
- `src/main/utils/stream-bridge.ts` — use shared broadcast
- `src/main/ipc/terminal-handler.ts` — use shared broadcast
- `src/main/tools/define-tool.ts` — use shared `isPathInside`
- `src/main/ipc/attachments-handler.ts` — use shared `isPathInside`

## Tests

- Unit: broadcastToWindows sends to all non-destroyed windows
- Unit: isPathInside handles symlinks, trailing slashes, case sensitivity
