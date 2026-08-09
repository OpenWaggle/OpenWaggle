# T3Code Test Parity Coverage Map (WS8)

Maps each T3Code test file that covers behavior OpenWaggle implemented to its OpenWaggle analog, or records why it is out of scope. Ported cases use OpenWaggle's own harness (vitest), not T3Code's `@effect/vitest`/`it.layer` style. E2E: T3Code has no e2e specs for these areas, so none are ported.

## Ported (T3Code test → OpenWaggle test)

| T3Code test | OpenWaggle test | Notes |
|---|---|---|
| `apps/web/src/components/GitActionsControl.logic.test.ts` (resolveQuickAction / buildMenuItems scenarios) | `src/renderer/src/features/git/lib/__tests__/git-quick-action.unit.test.ts` | 20 cases across the clean/ahead/behind/diverged/upstream/PR/default-ref/dirty/no-remote matrix incl. GitLab MR terminology. |
| `GitActionsControl.logic.test.ts` (buildGitActionProgressStages, requiresDefaultBranchConfirmation, resolveDefaultBranchActionDialogCopy, resolveAutoFeatureBranchName) | `src/shared/utils/__tests__/git-stacked-action.unit.test.ts` | Progress stages, default-branch confirmation gating + copy (PR/MR), auto feature-branch naming + collision suffixing, phase planning. |
| `apps/web/src/worktreeCleanup.test.ts` | `src/main/ipc/git/__tests__/worktree-cleanup.unit.test.ts` | Orphan detection (sole-owner / shared / different-worktree / no-worktree / unknown), path normalization, display formatting. |
| `apps/web/src/diffPanelStore.test.ts` | `src/renderer/src/features/diff-panel/state/__tests__/diff-scope-store.unit.test.ts` | Default scope (clean→branch, dirty→unstaged), preserve explicit selection across working-tree state change, clear incompatible fields on scope switch, base-ref memory, reveal-request increment, stale-turn reconciliation. |
| `packages/shared/src/sourceControl.test.ts` | `src/shared/utils/__tests__/source-control-presentation.unit.test.ts` + provider detection in `src/main/ipc/git/__tests__/vcs-status-parse.unit.test.ts` | PR vs MR terminology, generic fallback, host detection incl. port preservation and self-hosted GitHub/GitLab. |
| `apps/server/src/sourceControl/GitHubCli.test.ts`, `GitLabCli.test.ts`, `GitHubSourceControlProvider.test.ts`, `GitLabSourceControlProvider.test.ts` | `src/main/adapters/source-control/__tests__/{auth-parse,change-request-parse,gh-cli-adapter}.unit.test.ts` | Auth-status parse, PR/MR JSON→VcsChangeRequest map + state mapping + field trimming, list-skipping of invalid entries, cli-missing/not-authenticated/not-found typed failures (never throws). |
| `apps/server/src/git/GitWorkflowService.test.ts` | `src/main/ipc/git/__tests__/stacked-action-service.unit.test.ts` | Stacked-action orchestration: phase ordering branch→commit→push→pr, centralized stop-at-first-failure, pull-only, skip-commit-when-clean. |
| `apps/server/src/checkpointing/Diffs.test.ts` | `src/shared/utils/__tests__/turn-diff-parse.unit.test.ts` | Per-file additions/deletions, empty diff, rename-only (zero line changes), CRLF normalization. |
| `apps/server/src/checkpointing/CheckpointDiffQuery.test.ts`, `CheckpointStore.test.ts` | `src/main/store/__tests__/turn-checkpoints.integration.test.ts` | Record/get/list, query-by-turn-range, retention (prune-to-N), CASCADE delete, upsert. |
| `packages/client-runtime/src/state/vcs.test.ts` (combined status shaping) | `src/main/ipc/git/__tests__/vcs-status-service.unit.test.ts` + `useCombinedVcsStatus` | Local (no-network) vs Remote (fetch) with distinct not-a-repo / remote-unreachable failures. |

## Out of scope — no OpenWaggle analog by design

| T3Code test | Reason |
|---|---|
| `apps/server/src/git/GitManager.test.ts`, `apps/server/src/vcs/GitVcsDriver*.test.ts`, `VcsDriverRegistry/Process/ProjectConfig/Provisioning/StatusBroadcaster.test.ts` | God-module / driver-registry infra we intentionally did not port (ADR: thin handlers + focused services, no 2000-line modules). |
| `apps/server/src/sourceControl/{AzureDevOpsCli,AzureDevOpsSourceControlProvider,BitbucketApi,BitbucketSourceControlProvider,SourceControlDiscovery,SourceControlProviderRegistry,SourceControlRepositoryService,PrTemplateDetection}.test.ts` | Providers/infra beyond GitHub+GitLab; not implemented. |
| `apps/mobile/src/features/**/*.test.ts` (native review diff) | Mobile app; OpenWaggle is Electron desktop. |
| `apps/web/src/diffFileActions.test.ts` | Per-file stage/revert in the diff panel; OpenWaggle ships working-tree stage-all/revert-all (with a stronger obstruction-scan) rather than per-file actions. |
| `apps/web/src/lib/turnDiffTree.test.ts`, `lib/diffCollapse.test.ts`, `lib/diffRendering.test.ts` | Turn-diff tree + collapse/rendering UI not built; OpenWaggle renders working-tree/branch diffs via existing diff-display components. |
| `apps/web/src/lib/openPullRequestLink.test.ts`, `pullRequestReference.test.ts` | PR-reference parsing/link helpers not implemented; OpenWaggle opens `pr.url` directly. |
| `apps/web/src/components/BranchToolbar.logic.test.ts`, `state/paginatedBranches.test.ts` | Branch toolbar / paginated branch UI not part of this scope. |
| `packages/contracts/src/git.test.ts` | T3Code validates Effect-Schema contract shapes; OpenWaggle validates at IPC boundaries via `decodeUnknownOrThrow` and TS types, so there is no standalone runtime-schema suite for these git types. |
| `packages/client-runtime/src/state/{vcsAction,sourceControl}.test.ts` | T3Code's client-runtime optimistic-action state machine; OpenWaggle dispatches through the thin `useStackedGitActions` hook + main-process workflow service instead. |
| `packages/shared/src/git.test.ts` (normalizeGitRemoteUrl, parseGitHubRepositoryNameWithOwnerFromRemoteUrl, isTemporaryWorktreeBranch, applyGitStatusStreamEvent) | Remote-URL canonicalization, owner/repo parsing, temp-worktree-branch detection, and status-stream merging are T3Code helpers with no OpenWaggle analog (the CLIs own owner/repo; status is request/response, not streamed). `resolveAutoFeatureBranchName` from this module IS ported (see git-stacked-action.unit). |

## Preserved (not from T3Code)

- `src/main/ipc/git/__tests__/working-tree-service.{unit,integration}.test.ts` — obstruction-scanning `revert-all` safety (stronger than T3Code); unchanged and not regressed.
