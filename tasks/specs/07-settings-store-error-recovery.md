# 07 — Settings Store Error Recovery

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-04

---

## Problem

`src/renderer/src/stores/settings-store.ts:42-49` — both `loadSettings()` and `loadProviderModels()` are fire-and-forget async calls. If the IPC call throws (main process crash, IPC timeout, serialization error), the promise rejects silently. `isLoaded` never becomes `true`. The UI hangs indefinitely.

## What Exists

- `loadSettings()` at line 42–45: `await api.getSettings()` with no try-catch, no error state
- `loadProviderModels()` at line 47–49: same pattern
- `isLoaded: false` as initial state — never set to `true` on failure
- No retry mechanism

## Implementation

- [ ] Add `loadError: string | null` to `SettingsState`
- [ ] Wrap `loadSettings()` and `loadProviderModels()` in try-catch. On failure: set `isLoaded: true` (to unblock UI) and `loadError` to the error message
- [ ] In the renderer, check `loadError` and show a retry banner: "Failed to load settings. [Retry]"
- [ ] Add a `retryLoad()` action that clears the error and re-attempts

## Files to Touch

- `src/renderer/src/stores/settings-store.ts` — add error state, wrap async calls
- `src/renderer/src/components/settings/` — render error/retry UI

## Tests

- Unit: loadSettings failure sets loadError and isLoaded
- Unit: retryLoad clears error and re-fetches
- Component: error banner renders with retry button

## Risk if Skipped

Any IPC failure on startup permanently freezes the settings UI with no recovery path.
