# OpenWaggle UI Interaction PRD

Last updated: 2026-02-20
Owner: Product + Core App
Status: Implemented (HC-UI gap-closure baseline)
Document type: Combined PRD + detailed feature specification

## Executive Summary

OpenWaggle previously contained several visible controls that were static, disabled, or not wired to behavior. The 2026-02-19 implementation pass closes the remaining HC-UI product gaps for project switching, branch operations, execution mode selection, quality presets, rich attachments, and voice input while preserving runtime safety enforcement.

## Problem Statement

- Users need confidence that visible controls map to real behavior.
- Agent input quality/safety controls must be explicit and persisted.
- Attachment support must work across providers via native modality or text fallback.

## Goals

- Deliver clear, predictable interaction behavior for high-value controls.
- Prioritize developer workflow outcomes: inspect status, open terminal, commit quickly.
- Replace remaining placeholder controls with end-to-end behavior.
- Keep runtime policy enforcement aligned with UI-selectable execution mode.
- Preserve backward compatibility for existing settings and conversation history.

## Non-Goals

- Full MCP management UI implementation.
- Full skills installer/import UI implementation.
- Per-file diff review sidebar implementation in the first release.

## Target User and Jobs-to-be-Done

Primary user: developer working inside a repository with OpenWaggle.

Functional jobs:
- "I need to quickly open a terminal where I am already working."
- "I need to understand repo change state without leaving the chat."
- "I need to commit from within OpenWaggle with confidence."
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
- Add selectable execution mode controls with confirmation flow.
- Add branch management UI + IPC (list/checkout/create/rename/delete/set-upstream).
- Add rich attachment flow (text/PDF/image + OCR/text extraction fallback).
- Add quality preset selection and runtime model/parameter mapping.
- Add local Whisper transcription (tiny default) with typed fallback messaging.

Out of scope:
- Full right-side diff explorer UI (planned future phase).
- MCP management surface implementation beyond placeholder state.

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

### Completed (2026-02-19)

- Header terminal action, commit dialog, live git status, and copy-control removal.
- Execution mode switching (Default permissions / Full access) with confirmation for Full access.
- Branch list and mutation operations (checkout/create/rename/delete/set-upstream) with refresh wiring.
- Empty-state project dropdown with recent projects and active-thread project path updates.
- Composer quality presets (Low/Medium/High) mapped to runtime model/parameter resolution.
- Composer attachments (text/PDF/image) with extraction/OCR pipeline and provider fallback behavior.
- Composer voice input via local Whisper transcription (tiny default, base optional) with typed fallback guidance.
- Skills workspace with catalog, per-skill enable toggles, and SKILL.md preview from `.openwaggle/skills`.
- Composer slash references (`/skill-id`) for explicit skill activation while typing.
- Dynamic mid-run skill loading via `loadSkill` tool (metadata-first catalog + run-scoped full instruction loading).
- Nested `AGENTS.md` resolution with path-scoped precedence (root baseline + inferred package scopes) and on-demand `loadAgents` runtime loading.

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
  - Mitigation: runtime enforcement remains source of truth; UI toggles update persisted policy only.
- Risk: multimodal support varies by provider/model.
  - Mitigation: attach extracted text fallback for all providers; use native modality only where supported.

## Dependencies

- New/extended main/preload/renderer IPC:
  - `agent:send-message` payload contract
  - `conversations:update-project-path`
  - `git:branches:list|checkout|create|rename|delete|set-upstream`
  - `attachments:prepare`
- Shared types for settings quality/recent projects, branch DTOs/error codes, and attachment payloads.
- Runtime quality resolver and multimodal message mapping in agent loop.

## Release Readiness Criteria

- No clickable control in Header/Composer appears interactive without defined behavior.
- Commit dialog handles clean repo, staged/unstaged, and error states.
- Header git stats reflect actual repository status.
- No enabled control in Header/Composer is a no-op.
- Attachment workflow works through native modality or text fallback across supported providers.

## Detailed Feature Specification

Status legend: `implemented`, `deferred`, `future`

### HC-UI-001 Header terminal action

- Status: `implemented`
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

- Status: `implemented` (with success toast feedback)
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

### HC-UI-003 Header live git stats + diff sidebar

- Status: `implemented`
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

- Status: `implemented`
- Location: `src/renderer/src/components/layout/Header.tsx:93`
- Current: copy icon button exists but no defined product purpose.
- Target behavior:
  - Remove button and icon from header.
- Acceptance criteria:
  - No unused copy control remains in header.

### HC-UI-005 Empty-state project dropdown behavior

- Status: `implemented`
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

- Status: `implemented`
- Location: `src/renderer/src/components/layout/Sidebar.tsx:188`
- Current: enabled navigation to a dedicated Skills workspace view.
- Target behavior:
  - Open a Skills workspace panel with:
    - AGENTS.md status card
    - Discovered skill catalog from `.openwaggle/skills/*/SKILL.md`
    - Per-skill enable/disable toggles
    - SKILL.md preview

### HC-UI-013 Composer slash skill references

- Status: `implemented`
- Location: `src/renderer/src/components/composer/Composer.tsx`
- Target behavior:
  - Typing `/` at token start opens a filtered skill picker.
  - Selecting an item inserts `/skill-id` into the prompt.
  - Multiple skill references are supported in the same message.

### HC-UI-014 Dynamic skill loading during active runs

- Status: `implemented`
- Location:
  - `src/main/tools/tools/load-skill.ts`
  - `src/main/agent/standards-context.ts`
  - `src/main/agent/standards-prompt.ts`
- Target behavior:
  - Initial standards prompt exposes skill metadata only (id/name/description).
  - Agent can call `loadSkill` mid-run to fetch full `SKILL.md` instructions for a specific skill id.

### HC-UI-015 Nested AGENTS scope resolution (agents.md aligned)

- Status: `implemented`
- Location:
  - `src/main/standards/agents-resolver.ts`
  - `src/main/agent/standards-context.ts`
  - `src/main/agent/standards-prompt.ts`
  - `src/main/tools/tools/load-agents.ts`
- Target behavior:
  - Root `AGENTS.md` remains the baseline instruction source.
  - Nested `AGENTS.md` files are resolved by scope chain (root -> ancestor dirs -> nearest dir for target path).
  - Run-start prompt includes root plus inferred scoped instructions from user text/attachments.
  - Agent can call `loadAgents` mid-run for additional target paths without restarting the run.
  - Missing/malformed scoped files are warning-only and never block execution.
  - Loaded skills remain run-scoped (no automatic persistence to future turns).
  - Disabled skills are not dynamically loadable.
- Acceptance criteria:
  - Agent can continue the same run after loading a skill (no restart/memory wipe).
  - Duplicate `loadSkill` calls return structured `alreadyLoaded` information.
  - Missing/malformed/disabled skill requests return non-crashing structured errors.

### HC-UI-015 Orchestration run timeline and controls

- Status: `implemented` (beta baseline)
- Location:
  - `src/renderer/src/components/chat/ChatPanel.tsx`
  - `src/renderer/src/App.tsx`
- Target behavior:
  - Show latest orchestration run card inline with chat messages.
  - Surface run status (`running`, `completed`, `failed`, `cancelled`) plus fallback indicator.
  - Render recent orchestration lifecycle events (`task_started`, `task_succeeded`, etc.).
  - Provide `Cancel` control for active runs and `Retry` affordance for failed/cancelled runs.
- Technical requirements:
  - IPC channels for orchestration run listing/get/cancel and main-to-renderer orchestration events.
  - Main process persistence of orchestration runs in a dedicated store (`orchestration-runs`), separate from conversation history.
  - Agent send-message path defaults to orchestration mode with auto-fallback to classic execution when planning/orchestration setup fails.

### HC-UI-008 Composer attachment control

- Status: `implemented`
- Location: `src/renderer/src/components/composer/Composer.tsx` (attachment handling + chip rendering)
- Current: interactive attachment picker with chip preview/removal and preprocessing pipeline.
- Target behavior:
  - Support text/image/PDF uploads (max 5 files) with metadata + extracted-text persistence.
  - Use provider-native modality where available; fallback to extracted text for unsupported providers.

### HC-UI-009 Composer quality control

- Status: `implemented`
- Location: `src/renderer/src/components/composer/ComposerToolbar.tsx` (quality preset dropdown)
- Current: interactive Low/Medium/High selector persisted in settings.
- Target behavior:
  - Map quality presets to provider/model override + generation parameters.
  - Preserve selected model as fallback where curated mapping is unavailable.

### HC-UI-010 Composer voice input

- Status: `implemented`
- Location: `src/renderer/src/components/composer/VoiceRecorder.tsx` (UI) + `src/renderer/src/components/composer/useVoiceCapture.ts` (hook)
- Current: mic button enters recording mode (waveform + timer + stop), then transcribes locally in-app with Whisper tiny by default (no external STT endpoint).
- Target behavior:
- While in recording mode, `Enter` or the existing composer send arrow finalizes recording and auto-sends the transcribed message.
  - If recording is stopped without send, insert transcript into composer input (no auto-send) and provide typed fallback messaging when unavailable.

### HC-UI-011 Execution mode controls (Local / Full access)

- Status: `implemented`
- Location: `src/renderer/src/components/composer/ComposerStatusBar.tsx` (execution mode badge)
- Current: selectable Default permissions / Full access controls with Full access confirmation.
- Target behavior:
  - User-switchable execution mode persisted in settings.
  - New-profile default is Default permissions (`sandbox` mode); legacy profiles retain Full access until explicitly changed.
- Technical requirements:
  - Settings type extension for execution policy.
  - Agent request path must enforce policy at runtime, not only in UI.
  - Implementation note (2026-02-19): Agent runtime now enforces sandbox policy server-side by filtering approval-required tools before dispatch (with execution-time guards still in place).

### HC-UI-012 Branch badge and git refresh affordance

- Status: `implemented`
- Location: `src/renderer/src/components/composer/BranchPicker.tsx` (branch chip, search, mutations, refresh)
- Current: branch menu supports search, local/remote sections, and branch mutations; refresh icon is wired.
- Target behavior:
  - Manual git refresh updates status, branch list, and diff panel key.
  - Branch operations emit visible success/error feedback and trigger post-op refresh.

## Open Product Questions

- Should branch management move from prompt/confirm flows to dedicated modal components?
- Should attachment preview in chat bubbles render richer metadata (size/kind badges) beyond text summaries?
