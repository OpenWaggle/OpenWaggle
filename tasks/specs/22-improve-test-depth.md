# 22 — Improve Test Depth

**Status:** Planned
**Priority:** P4
**Severity:** Strategic
**Depends on:** None
**Origin:** H-16

---

## Problem

Many test files contain a single happy-path assertion. The most critical code paths (agent loop, tool approval flow, conversation persistence, streaming rendering) have shallow coverage.

## Implementation

- [ ] Audit test files with ≤2 tests. For each, add edge cases: invalid input, error paths, cancellation, empty state
- [ ] Priority targets by blast radius:
  - `src/main/agent/` — stream interruption, provider errors, tool approval timeout
  - `src/main/store/conversations.ts` — corrupt JSON, concurrent read/write, migration edge cases
  - `src/main/tools/define-tool.ts` — output truncation, Zod validation failures
  - `src/renderer/src/stores/chat-store.ts` — rapid state transitions, race conditions
- [ ] Set a coverage floor: 60% line coverage as a starting gate
- [ ] Add `pnpm test:coverage` to pre-push hook (after Spec 23)

## Files to Touch

- Multiple test files across `src/main/` and `src/renderer/`

## Tests

- This spec IS about adding tests — success metric is coverage floor met

## Review Notes (2026-02-25, codebase audit)

The renderer has a significant coverage gap: 8 component test files vs. 58 unit test
files. Specific high-risk untested components:

- **`ConnectionsSection.tsx` (743 lines)** — The largest UI component. Handles 6
  providers × (API key + subscription auth + test result + base URL) states. Zero
  component tests. This is the primary user-facing settings surface.
- **`SettingsDialog.tsx` (~280 lines)** — May be orphaned (Spec 36), but should be
  tested before deletion to confirm feature parity with `GeneralSection`.
- **`ChatPanel.tsx` (434 lines)** — Multi-agent turn splitting, streaming phase display,
  pending approval detection, askUser block detection. Core user experience, no component
  tests.

Consider adding renderer component test coverage as a priority target alongside the
main-process edge cases already listed above.
