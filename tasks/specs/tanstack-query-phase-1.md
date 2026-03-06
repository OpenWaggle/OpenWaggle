# TanStack Query Phase 1

**Status:** Completed
**Priority:** P1
**Severity:** DX / Reliability
**Origin:** User request on 2026-03-06

---

## Goal

Introduce TanStack Query for renderer IPC resource data without changing product behavior:

- teams / Waggle presets
- shared team preset reads in command palette
- MCP server list + mutations
- skills catalog + preview
- archived conversations

Keep Zustand and event hooks for runtime state, editable forms, and streaming.

## Checklist

- [x] Add TanStack Query dependency and renderer provider
- [x] Add shared renderer query client and query keys
- [x] Add shared Query test wrapper
- [x] Migrate teams / Waggle presets + command palette
- [x] Migrate MCP hook to Query
- [x] Migrate skills hook to Query
- [x] Migrate archived conversations to Query
- [x] Add or update tests for migrated resource flows
- [x] Run `pnpm test`
- [x] Run `pnpm check`
- [x] Run `npx -y react-doctor@latest . --verbose --diff main`
- [x] Update this spec with outcomes and review notes

## Review Notes

- Added renderer Query infrastructure with Electron-friendly defaults and a shared root provider.
- Added reusable query modules for shared team preset and archived conversation resource data plus shared query keys.
- Tightened the Query usage after review:
  - shared resource query definitions now use reusable `queryOptions` helpers where that improves imperative cache operations
  - renderer Query defaults now set `networkMode: 'always'` so Electron IPC resources are not treated like browser-online network requests
  - MCP mutation helpers now throw on `{ ok: false }` results so TanStack Query correctly models failures instead of treating them as successful mutations
  - skills toggle/refresh paths now invalidate/refetch through the Query client and surface mutation failures through hook state instead of leaking rejected promises to `void` callers
  - follow-up review fixes now separate initial-load errors from action errors in Query-backed screens so cached data stays visible when a mutation fails
  - archived-thread destructive actions now catch confirmation-dialog failures and keep the existing list visible with inline error feedback
  - abstraction pass aligned the shared layer with TkDodo's `queryOptions`-first approach: teams and archived conversations now expose shared options builders instead of trivial `useQuery` wrappers, and `useSkills` composes its resource queries from shared options helpers instead of rebuilding query configs inline
- Migrated `WaggleSection`, `CommandPalette`, `useMcp`, `useSkills`, and `ArchivedSection` to Query-backed resource loading while preserving local form/selection/runtime state in reducers or Zustand.
- Kept event-driven runtime boundaries intact:
  - MCP status events now patch the Query cache via `setQueryData`
  - chat/Waggle/terminal streaming remains outside Query
- Added Query-aware renderer tests:
  - new hook coverage for `useMcp` and `useSkills`
  - new component coverage for archived threads
  - new component coverage for MCP action-error rendering
  - updated Waggle settings coverage, including shared team-cache behavior with command palette
- Verification completed:
  - `pnpm test`
  - `pnpm check`
  - `npx -y react-doctor@latest . --verbose --diff main` → `100 / 100`
