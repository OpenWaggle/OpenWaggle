# HiveCode UI Interaction PRD

Last updated: 2026-02-19
Owner: Product + Core App
Status: Draft for implementation planning

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
