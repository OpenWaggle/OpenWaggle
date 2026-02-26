# 47 — In-Repo Decision Utility + Branching Refactor

**Status:** Done
**Priority:** P1
**Severity:** Medium
**Category:** Refactor
**Depends on:** None
**Origin:** User request (pattern-branching utility + switch/if-else migration)

---

## Summary

Implement a custom, optimized branching utility in-repo (`decision.ts`) and migrate targeted `switch` and long `if/else` chains across source + tests.

## Constraints

- No separate package/module for now.
- Custom API (not ts-pattern naming/API).
- Full migration pass in this task.
- Remove duplicate `* 2.*` files.
- Keep utility runtime smaller than ts-pattern baseline (raw + gzip).

## Implementation Checklist

### 1) Utility

- [x] Add `src/shared/utils/decision.ts`
- [x] API surface:
  - `choose(value)`
  - `chooseBy(value, tagKey)`
  - `.case(...)`
  - `.catchAll(...)`
  - `.assertComplete()`
  - `Rule.any`, `Rule.guard`, `Rule.either`, `Rule.object`, `Rule.array`, `Rule.exclude`
- [x] Compile-time narrowing + exhaustive discriminated-union support (`chooseBy`)

### 2) Tests for utility

- [x] Add `src/shared/utils/decision.unit.test.ts`
- [x] Add `src/shared/utils/decision.typecheck.ts`

### 3) Refactor branch logic

- [x] Migrate union-heavy switches first
- [x] Migrate remaining switches
- [x] Replace eligible long `if/else` chains with `choose/chooseBy` or guard-clause equivalents
- [x] Update tests accordingly

### 4) Duplicate cleanup

- [x] Resolve and remove all `* 2.*` duplicate files under `src/` (verified none present in this branch state)

### 5) Enforcement + size gates

- [x] Add `scripts/check-pattern-style.mjs`
- [x] Add `scripts/check-decision-size.mjs`
- [x] Wire scripts in `package.json`

### 6) Validation

- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm run check:pattern-style`
- [x] `pnpm run check:decision-size`

## File Matrix (Targeted)

- `src/main/store/conversations.ts`
- `src/main/ipc/attachments-handler.ts`
- `src/main/ipc/git/status-handler.ts`
- `src/main/agent/stream-part-collector.ts`
- `src/main/orchestration/service/model-runner.ts`
- `src/main/orchestration/service/conversation-summary.ts`
- `src/renderer/src/hooks/useAgentChat.ts`
- `src/renderer/src/components/chat/MessageBubble.tsx`
- `src/renderer/src/components/composer/ActionDialog.tsx`
- `src/renderer/src/stores/multi-agent-store.ts`
- `src/renderer/src/components/layout/CommitDialog.tsx`
- `src/renderer/src/components/layout/sidebar-utils.ts`
- `src/renderer/src/components/shared/ModelSelector.tsx`
- `src/renderer/src/components/settings/SettingsPage.tsx`
- `src/main/ipc/git-handler.integration.test.ts`
- Remaining inventoried long `if/else` chains where beneficial and clear

## Review

- Implemented custom in-repo `decision` utility with ergonomic API (`choose`, `chooseBy`, `Rule.*`) and exhaustive tagged matching support.
- Removed all `switch` and `else if` usage from `src/`; new style guard prevents regressions.
- Added decision utility size gate; current utility size is below ts-pattern baseline (`raw=5532B`, `gzip=1077B`).
- Verified no `* 2.*` duplicate files currently exist in this repository state.
- Validation status: all checks and tests pass.
