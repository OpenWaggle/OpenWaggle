# Git And Diff Behaviour Coverage Map

Which git, diff and worktree behaviours are covered, and by which test. Kept as a map of *behaviour → test* so it stays useful without depending on any other codebase.

## Covered

| Behaviour | Test | Notes |
|---|---|---|
| Quick-action resolution from combined VCS status | `src/renderer/src/features/git/lib/__tests__/git-quick-action.unit.test.ts` | 20 cases across the clean / ahead / behind / diverged / upstream / change-request / default-ref / dirty / no-remote matrix, including GitLab MR terminology. |
| Stacked-action progress stages, default-branch confirmation, auto branch naming | `src/shared/utils/__tests__/git-stacked-action.unit.test.ts` | Progress stages, default-branch confirmation gating and copy (PR/MR), auto feature-branch naming with collision suffixing, phase planning. |
| Session-worktree orphan detection and cleanup | `src/main/ipc/git/__tests__/worktree-cleanup.unit.test.ts` | Sole-owner / shared / different-worktree / no-worktree / unknown, path normalization, display formatting. |
| Diff-scope selection and memory | `src/renderer/src/features/diff-panel/state/__tests__/diff-scope-store.unit.test.ts` | Default scope (clean → branch, dirty → unstaged), preserving an explicit selection across a working-tree state change, clearing incompatible fields on scope switch, base-ref memory, reveal-request increment, stale-turn reconciliation. |
| Change-request terminology and host detection | `src/shared/utils/__tests__/source-control-presentation.unit.test.ts`, `src/main/ipc/git/__tests__/vcs-status-parse.unit.test.ts` | PR vs MR wording, generic fallback, host detection including port preservation and self-hosted GitHub/GitLab. |
| Source-control CLI adapters | `src/main/adapters/source-control/__tests__/{auth-parse,change-request-parse,gh-cli-adapter}.unit.test.ts` | Auth-status parsing, change-request JSON → `VcsChangeRequest` mapping, state mapping, field trimming, skipping invalid list entries, and typed cli-missing / not-authenticated / not-found failures (never throws). |
| Stacked-action orchestration | `src/main/ipc/git/__tests__/stacked-action-service.unit.test.ts` | Phase ordering branch → commit → push → change request, centralized stop-at-first-failure, pull-only, skip-commit-when-clean. |
| Unified-diff parsing into per-file summaries | `src/shared/utils/__tests__/turn-diff-parse.unit.test.ts` | Per-file additions/deletions, empty diff, rename-only (zero line changes), CRLF normalization, and splitting a Turn diff into per-file blocks. |
| Turn checkpoint storage and querying | `src/main/store/__tests__/turn-checkpoints.integration.test.ts` | Record / get / list, query by turn range, retention (prune to N), CASCADE delete, upsert, anchor-node round-trip. |
| Combined local + remote VCS status | `src/main/ipc/git/__tests__/vcs-status-service.unit.test.ts`, `useCombinedVcsStatus` | Local (no network) versus remote (fetch), with distinct not-a-repo and remote-unreachable failures. |
| Composer send gating for worktree mode | `src/renderer/src/features/git/lib/__tests__/worktree-send-plan.unit.test.ts` | Proceed / create-worktree / blocked, and defaulting the Worktree base ref to the current branch. |
| Base-ref choices for the Branch-diff combobox | `src/renderer/src/features/diff-panel/lib/__tests__/base-ref-choices.unit.test.ts` | Local/remote pairing preferring origin, plus filtering. |
| Checking a change request out into a worktree | `src/main/adapters/source-control/__tests__/gh-cli-adapter.unit.test.ts` | `gh pr checkout` / `glab mr checkout` typed primitive, plus the composer control. |
| Obstruction-scanning `revert-all` safety | `src/main/ipc/git/__tests__/working-tree-service.{unit,integration}.test.ts` | Pre-mutation scan for nested repositories and path conflicts before a destructive revert. |
| Diff rendering, review flow and navigator | `src/renderer/src/features/diff-panel/**/__tests__/*` | Review comment payload, code-view item caching, navigator tree, review submission (including the double-submit guard). |

## Deliberately not covered

| Area | Reason |
|---|---|
| Remote / multi-environment (cloud runners) | Deferred by explicit decision; no analog today. |
| Optimistic client-side action state machine | OpenWaggle dispatches through thin hooks plus main-process services, so there is no client-side optimistic state to test. |
| Driver-registry / god-module infrastructure | Deliberately not built: thin IPC handlers and focused services instead of multi-thousand-line modules. |
| Providers beyond GitHub and GitLab | Not implemented. |
| Mobile review surfaces | OpenWaggle is an Electron desktop app. |
| Per-file stage / revert in the diff panel | Ships working-tree stage-all / revert-all instead, with a stronger obstruction scan. Per-hunk actions are tracked in #150. |
| Change-request reference parsing and link building | Change-request URLs are opened directly. |
| Paginated branch listing UI | Not part of this scope. |
| Standalone runtime-schema suites for git types | Validation happens at IPC boundaries via `decodeUnknownOrThrow` plus TypeScript types. |
| Remote-URL canonicalization, owner/repo parsing, status-stream merging | The CLIs own owner/repo resolution, and status is request/response rather than streamed. |

## Known gaps

- **Git changes OpenWaggle did not make are not observed** (ADR 0016). No test covers agent-initiated `git checkout -b` reaching the UI, because the behaviour is deliberately absent.
- **The unit runner can under-report totals** when a worker crashes in a native destructor at teardown (#151). Not a failing test; tracked separately.
