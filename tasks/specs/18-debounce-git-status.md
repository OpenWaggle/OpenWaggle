# 18 — Debounce Git Status Checks

**Status:** Planned
**Priority:** P3
**Severity:** Medium
**Depends on:** None
**Origin:** H-11

---

## Problem

`src/main/ipc/git/shared.ts:8` defines `DIFF_GIT_MAX_BUFFER = 32MB`. The `git:status` and `git:diff` IPC handlers call git commands with this buffer on every invocation. No debouncing — rapid UI refreshes fire multiple concurrent git processes with 32MB buffer allocations.

## Implementation

- [ ] Add a 2-second debounce to `git:status` responses. Cache last result and return it for repeat calls within the window
- [ ] Invalidate cache on `git:commit` or explicit refresh
- [ ] Reduce `DIFF_GIT_MAX_BUFFER` to 8MB or 16MB
- [ ] Consider splitting `git:diff` into `git:diff-summary` (stat only) and `git:diff-full` (full patch, on-demand)

## Files to Touch

- `src/main/ipc/git/shared.ts` — reduce buffer constant
- `src/main/ipc/git/status-handler.ts` — add debounce/cache layer
- `src/main/ipc/git/diff-handler.ts` — optionally split into summary/full

## Tests

- Unit: repeated calls within 2s return cached result
- Unit: cache invalidated after git commit
- Unit: buffer reduced from 32MB
