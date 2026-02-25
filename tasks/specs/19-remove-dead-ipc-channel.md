# 19 — Remove Dead IPC Channel

**Status:** Planned
**Priority:** P4
**Severity:** Low
**Depends on:** None
**Origin:** H-12

---

## Problem

`src/shared/types/ipc.ts:188-191` defines a `'dialog:confirm'` invoke channel. A handler exists in `src/main/ipc/project-handler.ts`. The `OpenWaggleApi` exposes `showConfirm()`. But no renderer code ever calls `api.showConfirm()` — the channel is dead code.

## Implementation

- [ ] Verify with a project-wide grep that `showConfirm` and `dialog:confirm` have zero renderer call sites
- [ ] If confirmed dead: remove `'dialog:confirm'` from `IpcInvokeChannelMap`, remove `showConfirm` from `OpenWaggleApi`, remove handler, remove preload binding
- [ ] If intended for future use: add a `// TODO` comment and leave it

## Files to Touch

- `src/shared/types/ipc.ts` — remove or annotate
- `src/main/ipc/project-handler.ts` — remove handler
- `src/preload/api.ts` — remove binding

## Tests

- Grep verification: zero call sites confirms dead code
