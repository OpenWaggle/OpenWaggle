Review: Main Process + IPC + Shared Contracts (PR #145)

### 1. Branch-Management Removal (c92818b0) — CLEAN ✅

Exhaustive grep confirms:
- Zero references to renameGitBranch, deleteGitBranch, setGitBranchUpstream in src/
- Zero references to channels git:branches:rename, git:branches:delete,
  git:branches:set-upstream
- Zero references to GitBranchRenamePayload, GitBranchDeletePayload,
  GitBranchSetUpstreamPayload
- listGitBranches, checkoutGitBranch, createGitBranch remain fully wired: types →
  preload → handler → service

No orphans, no dangling registrations or type references.

### 2. Git Safety — No Blockers Found

- Revert-all: pre-mutation obstruction scan for nested repos and path conflicts;
  confirmation dialog runs before the reset. Acceptable TOCTOU window for a desktop
  app.
- Stacked-action commit: correctly gates on explicit paths selection when provided
  (review B2 fix). Falls back to git add --all only when no paths are specified.
  Comment explicitly documents the risk tradeoff.
- Default-branch confirmation: main-side dialog gate prevents bypassing from
  renderer.
- Push: hardcoded to origin; ponytail: comment marks this as deliberate ceiling.

### 3. Worktree Lifecycle & Per-Turn Checkpointing — CLEAN ✅

- Birth serialization via birthInFlight Map: single-threaded, promise-based. Correct
  dedup semantics.
- Turn capture: scratch index (never touches real index), anchored snapshot refs,
  incremental diffs, retention pruning with ref cleanup.
- Death/prune: orphan guard prevents deleting a worktree shared by another session;
  git's dirty-refusal protects uncommitted work.
- Migration chain (19→20→21→22→23) is properly ordered and additive.

### 4. Settings Persistence (diffSyntaxTheme / diffView / diffWrapLines)

All four layers are consistent:
- Keys: SETTINGS_KEY_DIFF_SYNTAX_THEME, SETTINGS_KEY_DIFF_VIEW,
  SETTINGS_KEY_DIFF_WRAP_LINES declared in keys.ts
- Sanitizers: resolveDiffSyntaxTheme, resolveDiffView, resolveDiffWrapLines with safe
  defaults
- Snapshot: buildSettingsSnapshot reads + resolves all three;
  buildNextSettingsSnapshot validates updates via resolveNextDiffSettings
- Persistence-plan: collectSettingsPatchWrites writes all three keys
- Types: DIFF_VIEWS, DIFF_SYNTAX_THEMES const arrays with derived literal types;
  DEFAULT_SETTINGS includes all defaults

No crash path from corrupted stored values — every sanitizer falls back to
DEFAULT_SETTINGS.*.

### 5. IPC Contract Drift — CLEAN ✅

All 14 new IPC channels have exactly one handler registration:
- git:change-request:{list,checkout}
- git:branch-diff, git:working-tree:{stage-all,revert-all}
- git:worktrees:{list,create,remove}
- git:vcs-status:{local,remote}
- git:stacked-action:run
- sessions:turn-checkpoints:list, sessions:turn-diff:get, sessions:set-worktree-plan

No declared-but-unhandled or handled-but-undeclared channels.

────────────────────────────────────────────────────────────────────────────────

### Findings

MINOR | src/main/skills/skill-catalog.ts:1-301 | File is 301 lines (cap is 300) |
Trivially exceeded; 4-line delta from this PR. | Extract one helper or constant to a
sibling module.

MINOR | src/main/ipc/git/status-handler.ts:36 | baseRef validated with plain typeof
check instead of Schema decode | Inconsistent with the pattern in all other handlers
(everything else uses decodeUnknownOrThrow). The empty-string fallback is intentional
but could mask a renderer bug silently. | Use Schema.String or at minimum
decodeUnknownOrThrow(Schema.String, rawBaseRef) for consistency.

MINOR | src/main/ipc/git/status-service.ts:62-64 | getGitBranchDiff throws an Error
instead of returning a discriminated-union failure result | Violates the project
standard "discriminated-union results with explicit error codes". The renderer must
use try/catch instead of checking .ok. Consistent with existing getGitDiff pattern
though, so not introduced by this PR. | Consider returning { ok: false, code, message
} for new callers; keep as-is if breaking the existing git:diff handler pattern is
out of scope.

────────────────────────────────────────────────────────────────────────────────

No BLOCKER or MAJOR findings in this scope. The branch-management removal is
complete, git safety is well-defended, worktree lifecycle is properly serialized,
settings persistence is fully consistent across all layers, and IPC contracts are
aligned.
