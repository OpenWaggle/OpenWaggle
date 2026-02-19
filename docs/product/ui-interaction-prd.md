# HiveCode UI Interaction PRD

Last updated: 2026-02-19
Owner: Product + Core App
Status: Draft for implementation planning
Document type: Combined PRD + detailed feature specification

## Executive Summary

HiveCode currently contains several visible controls that are either static, disabled, or not wired to behavior. This creates a trust gap: the UI implies capability that does not yet exist. This PRD defines a phased strategy to convert placeholder controls into reliable workflows, starting with terminal and commit flows and preparing future sandbox/access controls.

## Problem Statement

- Users see clickable-looking controls without behavior.
- Header git stats are hardcoded, reducing confidence in code-state awareness.
- Core daily actions (open terminal, commit) are not end-to-end from the top bar.
- Execution-mode controls (Local / Full access) visually resemble controls but are not actionable.

## Goals

- Deliver clear, predictable interaction behavior for high-value controls.
- Prioritize developer workflow outcomes: inspect status, open terminal, commit quickly.
- Keep unfinished features explicitly disabled to avoid misleading interactions.
- Establish technical foundations (git IPC + execution mode settings) for later expansion.

## Non-Goals

- Full MCP management UI implementation.
- Full skills catalog/installer UI implementation.
- Voice input, attachment upload, and quality-mode execution in this phase.
- Per-file diff review sidebar implementation in the first release.

## Target User and Jobs-to-be-Done

Primary user: developer working inside a repository with HiveCode.

Functional jobs:
- "I need to quickly open a terminal where I am already working."
- "I need to understand repo change state without leaving the chat."
- "I need to commit from within HiveCode with confidence."
- "I need to control agent execution safety mode."

Emotional jobs:
- "I need to trust that visible controls do what they imply."
- "I need to feel safe before allowing full-access operations."

## Scope

In scope:
- Header terminal action (replace ambiguous "Open" behavior).
- Commit dialog and commit pipeline.
- Live git diff summary in header.
- Remove misleading copy action.
- Keep unfinished controls disabled with explicit "coming soon" framing.
- Define disabled execution-mode controls as future switchable system.

Out of scope:
- Full right-side diff explorer UI (planned future phase).
- MCP/Skills feature implementation beyond placeholder state.

## Strategic Prioritization

Scoring: high impact + low/medium effort first.

| Feature | Customer Impact | Business/Trust Impact | Effort | Priority |
| --- | --- | --- | --- | --- |
| Header terminal action | High | Medium | Low | P0 |
| Remove header copy control | Medium | Medium | Low | P0 |
| Live git summary in header | High | High | Medium | P1 |
| Commit dialog + git commit IPC | High | High | Medium/High | P1 |
| Execution mode controls (disabled prep) | Medium | High | Low | P1 |
| Hero project dropdown behavior | Medium | Medium | Low/Medium | P2 |
| MCP/Skills disabled polish | Low | Medium | Low | P3 |
| Composer attach/quality/mic | Medium | Medium | High | Later |
| Right diff sidebar per-file | High | High | High | Later |

## Roadmap

### Now (0-3 weeks)

- Implement Header terminal action and icon.
- Remove Header copy button.
- Keep Local / Full access / branch / refresh visually disabled and explicit.
- Keep MCP, Skills, Attach, Quality, Mic as disabled placeholders.

### Next (3-6 weeks)

- Implement git status IPC (`git:status`) and wire live header diff numbers.
- Implement commit dialog UX with validation.
- Implement git commit IPC (`git:commit`) and post-commit refresh behavior.

### Later (6-12+ weeks)

- Implement right-side diff browser with per-file changes and patch preview.
- Implement execution mode switching (sandbox vs full access).
- Implement branch selection + refresh control.
- Implement attachments, quality presets, and voice input.

## Success Metrics

Product metrics:
- % sessions using header terminal action.
- % sessions using commit dialog.
- Time from first edit to commit completion.

Quality metrics:
- Error rate for commit attempts.
- % of UI controls in main surfaces that are fully wired or explicitly disabled.
- Reduction in user-reported "button does nothing" issues.

## Risks and Mitigations

- Risk: exposing commit flows without clear errors creates destructive confusion.
  - Mitigation: explicit validation + structured error states in dialog.
- Risk: git status polling can cause performance overhead.
  - Mitigation: event-based refresh on project/thread changes and explicit refresh trigger.
- Risk: execution mode controls may imply unimplemented security guarantees.
  - Mitigation: disabled state until enforcement path exists end-to-end.

## Dependencies

- New main/preload/renderer IPC for git operations:
  - `git:status`
  - `git:commit`
- Shared types for git status/commit payloads.
- Settings extension for execution policy mode (future phase).

## Release Readiness Criteria

- No clickable control in Header/Composer appears interactive without defined behavior.
- Commit dialog handles clean repo, staged/unstaged, and error states.
- Header git stats reflect actual repository status.
- Placeholder controls are intentionally disabled with clear affordance.

## Detailed Feature Specification

Status legend: `planned`, `deferred`, `future`

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
  - Primary action disabled until valid message exists.
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

### HC-UI-007 Skills nav placeholder

- Status: `deferred`
- Location: `src/renderer/src/components/layout/Sidebar.tsx:188`
- Current: disabled button.
- Target behavior:
  - Keep disabled until skills management surface exists.
  - Tooltip or helper text: `Coming soon`.

### HC-UI-008 Composer attachment control

- Status: `future`
- Location: `src/renderer/src/components/composer/Composer.tsx:105`
- Current: disabled `+` button.
- Target behavior:
  - Keep disabled for now.
  - Future: add file picker + attachment chips + send payload support.

### HC-UI-009 Composer quality control

- Status: `future`
- Location: `src/renderer/src/components/composer/Composer.tsx:123`
- Current: disabled "Extra High" selector.
- Target behavior:
  - Keep disabled for now.
  - Future: map quality presets to provider execution options.

### HC-UI-010 Composer voice input

- Status: `future`
- Location: `src/renderer/src/components/composer/Composer.tsx:137`
- Current: disabled mic button.
- Target behavior:
  - Keep disabled for now.
  - Future: audio capture + transcription insertion in composer.

### HC-UI-011 Execution mode controls (Local / Full access)

- Status: `planned` (disabled placeholders now), `future` (switchable)
- Location:
  - `src/renderer/src/components/composer/Composer.tsx:180` (Local)
  - `src/renderer/src/components/composer/Composer.tsx:187` (Full access)
- Current: static display chips (not buttons), look selectable.
- Target behavior:
  - Convert to explicit disabled controls now.
  - Future: user-switchable execution mode, with initial support focused on Full access vs Sandbox.
  - Local execution feasibility remains open.
- Technical requirements:
  - Settings type extension for execution policy.
  - Agent request path must enforce policy at runtime, not only in UI.

### HC-UI-012 Branch badge and git refresh affordance

- Status: `planned` (disabled placeholder now), `future` (interactive)
- Location:
  - `src/renderer/src/components/composer/Composer.tsx:199` (branch chip)
  - `src/renderer/src/components/composer/Composer.tsx:206` (refresh icon)
- Current: static visuals with no handlers.
- Target behavior:
  - Keep disabled until git IPC foundations ship.
  - Future: branch switcher + manual git status refresh.

## Open Product Questions

- Should commit dialog include staging controls or commit all tracked changes by default?
- Should per-file right diff sidebar be read-only initially, or include staging/unstaging actions?
- What are minimum safety confirmations when switching to Full access mode?
