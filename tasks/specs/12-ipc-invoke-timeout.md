# 12 — IPC Invoke Timeout

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-18

---

## Problem

Every `api.*` call from the renderer is an `ipcRenderer.invoke()` that returns a Promise. If the main process hangs, the Promise never resolves. The renderer waits indefinitely. There is no global timeout wrapper, no abort mechanism, and no UI indicator that an IPC call is stalled.

## Implementation

- [ ] Add a `withTimeout(promise, ms, label)` utility in `src/preload/api.ts` or `src/renderer/src/lib/ipc.ts`
- [ ] Wrap all `ipcRenderer.invoke()` calls with a default timeout (30s for most, 120s for agent operations)
- [ ] On timeout: reject with a typed `IpcTimeoutError` so the renderer can show "Request timed out — retry?"
- [ ] For agent streaming: add a stall detector that fires if no chunk arrives for 60s

## Files to Touch

- `src/preload/api.ts` or `src/renderer/src/lib/ipc.ts` — timeout wrapper
- `src/renderer/src/components/chat/ChatPanel.tsx` — stall detection UI

## Tests

- Unit: timeout rejects with IpcTimeoutError after configured ms
- Unit: successful response before timeout resolves normally

## Risk if Skipped

Any main-process hang freezes the entire UI with no recovery. User must force-quit.
