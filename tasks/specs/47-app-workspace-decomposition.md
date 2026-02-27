# Spec 47 - AppWorkspace Decomposition

## Goal
Split `AppWorkspaceView.tsx` into smaller composable units so each file has a single concern and is easier to follow.

## Plan
- [x] Decompose workspace shell into focused layout components.
- [x] Remove controller/context wrapper pattern and wire components directly via focused hooks/stores.
- [x] Collapse pass-through chat/skills wrappers so feature panels self-wire where appropriate.
- [x] Remove sidebar pass-through wrapper by making `Sidebar` self-wired and using it directly in shell layout.
- [x] Remove thin workspace/settings prop-forward wrappers (`AppWorkspaceView`, `ToastOverlay` message pass-through, `SettingsNav` prop pass-through) to keep top-level composition self-wired.
- [x] Keep runtime behavior identical (chat, skills, diff panel, terminal, waggle).
- [x] Run verification (`pnpm check`, `react-doctor --diff main`, full-repo React Doctor scan).

## Review
- Added:
  - `src/renderer/src/components/app/workspace/useWorkspaceLifecycle.ts`
- Updated:
  - `src/renderer/src/App.tsx` (uses `WorkspaceShell` directly)
  - `src/renderer/src/components/app/AppSettingsView.tsx` (uses self-wired `ToastOverlay`)
  - `src/renderer/src/components/app/ToastOverlay.tsx` (self-wired from `useUIStore`)
  - `src/renderer/src/components/app/workspace/WorkspaceShell.tsx` (self-wired lifecycle; no toast prop forwarding)
  - `src/renderer/src/components/app/workspace/WorkspaceMainContent.tsx` (directly renders `SkillsPanel`/`ChatPanel`)
  - `src/renderer/src/components/app/workspace/WorkspaceTerminal.tsx` (direct hook wiring)
  - `src/renderer/src/components/layout/Sidebar.tsx` (self-wired; no prop injection wrapper)
  - `src/renderer/src/components/layout/Header.tsx` (self-wired store/hooks; no wrapper props)
  - `src/renderer/src/components/chat/ChatPanel.tsx` (self-wired chat/diff/waggle/skills dependencies)
  - `src/renderer/src/components/skills/SkillsPanel.tsx` (self-wired project/skills dependencies)
  - `src/renderer/src/components/settings/SettingsNav.tsx` (self-wired tab state/actions)
  - `src/renderer/src/components/settings/SettingsPage.tsx` (uses self-wired `SettingsNav`)
  - `src/renderer/src/components/settings/sections/connections/SubscriptionRow.tsx` (self-wired auth state/actions)
  - `src/renderer/src/components/settings/sections/ConnectionsSection.tsx` (passes only provider identity/layout to `SubscriptionRow`)
- Removed:
  - `src/renderer/src/components/app/AppWorkspaceView.tsx`
  - `src/renderer/src/components/app/workspace/useAppWorkspaceController.ts`
  - `src/renderer/src/components/app/workspace/WorkspaceControllerContext.tsx`
  - `src/renderer/src/components/app/workspace/WorkspaceHeaderBar.tsx`
  - `src/renderer/src/components/app/workspace/WorkspaceChatContent.tsx`
  - `src/renderer/src/components/app/workspace/WorkspaceSidebar.tsx`
  - `src/renderer/src/components/app/workspace/useWorkspaceNavigation.ts`
- Verification:
  - `pnpm check` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (100/100)
  - Full-repo React Doctor temp-copy scan ✅ (100/100)
