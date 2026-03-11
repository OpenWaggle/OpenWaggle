# TanStack Query Migration Assessment

**Status:** Done
**Priority:** P2
**Severity:** DX
**Origin:** User request on 2026-03-06

---

## Goal

Assess whether TanStack Query would improve the renderer's IPC-backed async data flows, identify the best migration targets, estimate boilerplate reduction, and recommend a phased adoption plan.

## Checklist

- [x] Inventory renderer async IPC patterns
- [x] Classify good Query candidates vs state/event-driven code
- [x] Estimate boilerplate removed for the highest-value targets
- [x] Recommend a phased migration strategy
- [x] Record review notes and conclusions

## Review Notes

- Query is a good fit for IPC-backed resource reads with mutation invalidation patterns, especially:
  - `useMcp`
  - `useSkills`
  - `WaggleSection` team preset loading/mutations
  - `ArchivedSection`
  - lightweight `listTeams` reads such as `CommandPalette`
- Query is not a good fit for renderer event streams or session/app state:
  - chat streaming, Waggle streaming, terminal subscriptions, agent phase, background run event monitoring, OAuth event subscriptions
  - local editable form state, selected conversation state, and other UI state that already belongs in Zustand/local reducers
- Highest-value migration targets are the places that currently hand-roll:
  - `useEffect` mount fetches
  - local `isLoading` / `error` state
  - manual `refresh()` helpers
  - mutation-followed-by-refetch patterns
  - cancellation flags like `active` / `isMounted`
- Rough boilerplate reduction estimate for a focused first wave:
  - `useMcp`: ~20-25 lines
  - `useSkills`: ~35-45 lines
  - `ArchivedSection`: ~15-20 lines
  - `WaggleSection` presets path only: ~45-70 lines
  - `CommandPalette` preset fetch: ~5 lines
  - first-wave total: roughly ~120-165 lines of async-state boilerplate removed
- Second-wave candidates have value but a lower payoff-to-risk ratio:
  - `git-store` status/branches
  - parts of `provider-store`
  - conversation list/detail reads if the team wants query-backed cache semantics
- Recommended adoption model:
  - keep Zustand for app/session state and event-driven flows
  - add TanStack Query only for IPC-backed query/mutation resources
  - configure Electron-friendly defaults (`retry: false`, `refetchOnWindowFocus: false`)
  - expose query keys and thin wrappers around IPC methods to keep the migration consistent
