# Welcome Project Picker Single Click

## Goal

Remove the extra click in the empty welcome state so the visible project CTA opens the native folder picker directly.

## Plan

- [x] Update the welcome screen so the no-project CTA opens the folder picker directly.
- [x] Keep the active-project picker and recent-project menu behavior unchanged.
- [x] Add a renderer regression test for the one-click empty-state flow.
- [x] Update the UI interaction PRD to reflect the new empty-state behavior.
- [x] Run verification for the renderer change, including React Doctor.

## Review

- The empty welcome-state CTA now opens the native folder picker directly, removing the intermediate `Select folder…` step.
- The active-project trigger still opens the existing project picker and recent-project menu.
- Verification:
  - `pnpm test:component -- --run src/renderer/src/components/chat/__tests__/ChatPanel.component.test.tsx`
  - `pnpm check`
  - `npx -y react-doctor@latest . --verbose --diff main`
