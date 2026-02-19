# HiveCode UI Placeholder Interaction Spec

Last updated: 2026-02-19
Source inputs: current UI audit + user clarifications
Status legend: `planned`, `deferred`, `future`

## Feature Inventory

### HC-UI-001 Header terminal action

- Status: `planned`
- Location: `src/renderer/src/components/layout/Header.tsx:53`
- Current: "Open" button has no click handler.
- Target behavior:
  - Replace text-only button intent with terminal action.
  - Add terminal icon.
  - Clicking toggles terminal panel visibility.
- UX details:
  - Tooltip: `Open terminal` when closed, `Hide terminal` when open.
  - Disabled state only when no project is selected.
- Technical requirements:
  - Add `onToggleTerminal` and `terminalOpen` props from `App.tsx` to `Header`.
  - Reuse existing terminal panel state (`terminalOpen`).
- Acceptance criteria:
  - Click opens terminal when closed.
  - Click closes terminal when open.
  - Icon and label match behavior.

### HC-UI-002 Header commit dialog

- Status: `planned`
- Location: `src/renderer/src/components/layout/Header.tsx:68`
- Current: button has no click handler.
- Target behavior:
  - Open a commit dialog.
  - Show changed files summary and commit message input.
  - Optional `Amend last commit` toggle.
  - Submit runs commit pipeline and closes on success.
- UX details:
  - Primary action disabled until valid message exists (unless amend-only is explicitly supported).
  - Show loading and explicit error states.
  - Show success feedback and trigger header stats refresh.
- Technical requirements:
  - New IPC `git:status` to hydrate changed files.
  - New IPC `git:commit` with payload `{ message, amend }`.
  - Error mapping for git failures (empty tree, no staged changes, merge in progress).
- Acceptance criteria:
  - Dialog opens from header button.
  - Commit can complete successfully and refreshes git status.
  - Failure states are visible and actionable.

### HC-UI-003 Header live git stats + future diff sidebar

- Status: `planned` (stats), `future` (sidebar)
- Location: `src/renderer/src/components/layout/Header.tsx:87`
- Current: hardcoded `+441 / -348`.
- Target behavior:
  - Replace hardcoded values with real additions/deletions from `git:status`.
  - Refresh on project change, conversation change, successful commit, and explicit refresh actions.
  - Future: clicking stats opens right sidebar with per-file diffs.
- Technical requirements:
  - Shared type for git summary `{ additions, deletions, filesChanged }`.
  - Renderer store hook for git status state and refresh.
- Acceptance criteria:
  - Stats match current repository state.
  - Stats update without app restart after commit.

### HC-UI-004 Remove header copy action

- Status: `planned`
- Location: `src/renderer/src/components/layout/Header.tsx:93`
- Current: copy icon button exists but no defined product purpose.
- Target behavior:
  - Remove button and icon from header.
- Acceptance criteria:
  - No unused copy control remains in header.

### HC-UI-005 Empty-state project dropdown behavior

- Status: `planned`
- Location: `src/renderer/src/components/chat/ChatPanel.tsx:129`
- Current: project name with chevron appears as button but no click handler.
- Target behavior:
  - Click opens project picker/recent project menu.
  - Selection updates active conversation project path.
- Technical requirements:
  - Reuse `project:select-folder` IPC plus optional recent-path persistence.
- Acceptance criteria:
  - Button always does something when shown.

### HC-UI-006 MCPs nav placeholder

- Status: `deferred`
- Location: `src/renderer/src/components/layout/Sidebar.tsx:178`
- Current: disabled button.
- Target behavior:
  - Keep disabled until MCP management surface exists.
  - Tooltip or helper text: `Coming soon`.
- Acceptance criteria:
  - Clearly disabled, no ambiguous interactive affordance.

### HC-UI-007 Skills nav placeholder

- Status: `deferred`
- Location: `src/renderer/src/components/layout/Sidebar.tsx:188`
- Current: disabled button.
- Target behavior:
  - Keep disabled until skills management surface exists.
  - Tooltip or helper text: `Coming soon`.
- Acceptance criteria:
  - Clearly disabled, no ambiguous interactive affordance.

### HC-UI-008 Composer attachment control

- Status: `future`
- Location: `src/renderer/src/components/composer/Composer.tsx:105`
- Current: disabled `+` button, title says coming soon.
- Target behavior:
  - Keep disabled for now.
  - Future: add file picker + attachment chips + send payload support.
- Acceptance criteria:
  - Disabled state remains explicit until backend/model message schema supports attachments.

### HC-UI-009 Composer quality control

- Status: `future`
- Location: `src/renderer/src/components/composer/Composer.tsx:123`
- Current: disabled "Extra High" selector.
- Target behavior:
  - Keep disabled for now.
  - Future: map quality presets to provider execution options.
- Acceptance criteria:
  - No interactive affordance until preset mapping exists.

### HC-UI-010 Composer voice input

- Status: `future`
- Location: `src/renderer/src/components/composer/Composer.tsx:137`
- Current: disabled mic button.
- Target behavior:
  - Keep disabled for now.
  - Future: audio capture + transcription insertion in composer.
- Acceptance criteria:
  - Disabled state preserved; no dead clicks.

### HC-UI-011 Execution mode controls (Local / Full access)

- Status: `planned` (as disabled placeholders now), `future` (full switchability)
- Location:
  - `src/renderer/src/components/composer/Composer.tsx:180` (Local)
  - `src/renderer/src/components/composer/Composer.tsx:187` (Full access)
- Current: static display chips (not buttons), look selectable.
- Target behavior:
  - Convert to explicit disabled controls now.
  - Future: user-switchable execution mode, with initial support focused on Full access vs Sandbox.
  - Local execution feasibility remains open and should be treated separately.
- Technical requirements:
  - Settings type extension for execution policy.
  - Agent request path must enforce policy at runtime, not only in UI.
- Acceptance criteria:
  - Current phase: control styling clearly indicates disabled.
  - Future phase: mode persists and affects agent/tool execution behavior.

### HC-UI-012 Branch badge and git refresh affordance

- Status: `planned` (disabled placeholder now), `future` (interactive)
- Location:
  - `src/renderer/src/components/composer/Composer.tsx:199` (branch chip)
  - `src/renderer/src/components/composer/Composer.tsx:206` (refresh icon)
- Current: static visuals with no handlers.
- Target behavior:
  - Keep disabled until git IPC foundations ship.
  - Future: branch switcher + manual git status refresh.
- Acceptance criteria:
  - No misleading click affordance before feature launch.

## Implementation Phasing

### Phase A: Trust cleanup (fast)

- HC-UI-001
- HC-UI-004
- Disabled styling pass for HC-UI-011 and HC-UI-012
- Tooltip copy updates for deferred controls

### Phase B: Git foundation

- `git:status` IPC
- Header live stats (HC-UI-003)
- Refresh wiring for state transitions

### Phase C: Commit workflow

- Commit dialog UI (HC-UI-002)
- `git:commit` IPC
- Success/error telemetry and status refresh

### Phase D: Extended workspace interactions

- Empty-state project dropdown behavior (HC-UI-005)
- Branch switcher and manual refresh (HC-UI-012)
- Full-access vs sandbox mode switching (HC-UI-011)

### Phase E: Future platform work

- Right diff sidebar
- Attachments
- Quality presets
- Voice input
- MCPs/Skills management surfaces

## Open Product Questions

- Should commit dialog include staging controls or commit all tracked changes by default?
- Should per-file right diff sidebar be read-only initially, or include staging/unstaging actions?
- What are minimum safety confirmations when switching to Full access mode?
