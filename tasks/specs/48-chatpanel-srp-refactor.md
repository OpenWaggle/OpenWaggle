# Spec 48 - ChatPanel SRP Refactor

## Goal
Refactor `ChatPanel` so each module has a single clear responsibility while preserving existing chat, waggle, approval, command-palette, and diff-panel behavior.

## Plan
- [x] Extract pending tool interaction parsing/scanning into a dedicated helper module.
- [x] Extract chat runtime wiring (hooks + actions + derived state) into a dedicated controller hook.
- [x] Split transcript rendering and pinned-footer controls into focused presentational components.
- [x] Keep `ChatPanel` as composition/layout owner (main column + diff side panel) only.
- [x] Remove controller prop drilling from split chat sections by consuming section data directly from focused hooks/store selectors.
- [x] Update/keep component tests green for `ChatPanel` behavior after refactor.
- [x] Run verification: `pnpm check`, `react-doctor --diff main`, and targeted ChatPanel component tests.

## Review
- Chat split modules are now self-wired and no longer receive mega prop lists from `ChatPanel`.
- Added `chat-panel-controller-store` as a focused Zustand bridge so `ChatPanel` owns one controller instance while leaf sections consume only the state/actions they need.
- Updated `ChatPanel.component.test.tsx` to mock the controller hook seam and validate welcome, phase-indicator, message rendering, and composer behavior against the new architecture.
- Verification run:
  - `pnpm check` ✅
  - `pnpm test:component src/renderer/src/components/chat/__tests__/ChatPanel.component.test.tsx` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (score 100/100, no issues)
