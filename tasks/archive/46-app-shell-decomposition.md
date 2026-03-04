# Spec 46 - App Shell Decomposition

## Goal
Make the app shell easier to reason about by reducing `App.tsx` complexity and eliminating large prop-bundle wiring.

## Plan
- [x] Extract reusable app-shell UI pieces (`ToastOverlay`, settings shell, workspace shell) into focused components.
- [x] Reduce `App.tsx` to a thin route/orchestration component (loading + settings/chat view switch only).
- [x] Remove `React.ComponentProps` prop-bundle pattern from the app shell and use direct, explicit local props/handlers in decomposed components.
- [x] Keep behavior identical (no UX/logic regressions in sidebar/header/chat/skills/diff/terminal/waggle).
- [x] Run verification (`pnpm check`, `npx -y react-doctor@latest . --verbose --diff main`).

## Review
- Added:
  - `src/renderer/src/components/app/ToastOverlay.tsx`
  - `src/renderer/src/components/app/AppSettingsView.tsx`
  - `src/renderer/src/components/app/AppWorkspaceView.tsx`
- Rewrote `src/renderer/src/App.tsx` into a thin orchestrator.
- Removed the app-shell `React.ComponentProps` prop-bundle indirection and switched to direct explicit props where used.
- Verification:
  - `pnpm check` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (100/100)
  - Full-repo React Doctor temp-copy scan ✅ (100/100)
