wrap up my
review here.

Here's my review:

────────────────────────────────────────────────────────────────────────────────

Review: Renderer Git Store, Working-Path Resolution, Refresh Wiring

### 1. git-store.ts — Map shape, request IDs, selector

Clean. The map-keyed design is sound. selectWorkingTreeStatus returning the
module-level EMPTY_WORKING_TREE_STATUS constant is correct for zustand: all
subscribers for a missing/null path get the same reference, preventing spurious
re-renders. patchWorkingTree produces a new object only for the affected path's
slot, so unrelated-path subscribers see no reference change.

MINOR | src/renderer/src/features/git/state/git-store.ts:58 |
latestStatusRequestIdByPath never evicts entries | Each refreshed working path
permanently adds a Map entry (a number). Not a real leak for practical session
counts, but if useSessionGitIndicators refreshes status for every sidebar session's
worktree, the map grows with total distinct worktrees ever opened. Acceptable today;
note for future eviction if sessions become ephemeral or numerous. | No fix required
now; document ceiling with a ponytail: comment if desired.

### 2. useActiveWorkingPath / useGit — cross-feature import

Clean architecturally. git/hooks/useActiveWorkingPath → @/features/chat/state is
through the public barrel. chat/state/ does NOT import from git/, so there is no
module-level cycle. Multiple other features already import from chat/state in the
same pattern (sidebar, diff-panel, composer, sessions). The import-boundaries lint
rule passes.

### 3. useGitRefresh — closures, cleanup, broadcast

Clean. All three effects correctly list their captured values (workingPath,
repositoryPath, stable zustand actions) in their dependency arrays. The debounce
timer is cleaned up on unmount. On session switch, deps change → effect
re-subscribes with fresh paths, so no stale closure can refresh an old session's
tree. The onGitWorkingTreeChanged subscription correctly gates on path equality
before acting.

### 4. Call-site audit — project path vs. working path

BLOCKER | src/renderer/src/shell/Header.tsx:61 | commitGit(projectPath, { message,
amend, paths }) uses useProject().projectPath | In worktree mode this commits to the
primary checkout instead of the session's worktree. useGit() already exposes
workingPath; the commit must target it. This is a destructive action on the wrong
tree. | Destructure workingPath from useGit() and pass it to commitGit.

MAJOR | src/renderer/src/shell/Header.tsx:47 | handleRefreshGit() passes projectPath
 to refreshGitStatus | Manual refresh in worktree mode loads status for the primary
checkout, not what the user is looking at. | Use workingPath from useGit() for
status and repositoryPath for branches.

MAJOR | src/renderer/src/features/composer/hooks/useActionDialogController.ts:139 |
git.createBranch(projectPath, { name, checkout: true }) | Creates and checks out a
branch in the primary checkout instead of the session's worktree. | Use
git.workingPath (or a local from useGit()) for the mutation target.

MAJOR | src/renderer/src/features/composer/hooks/useBranchPickerController.ts:37 |
git.checkoutBranch(projectPath, { name }) | Same issue: checkout targets the project
rather than the working tree. | Use git.workingPath.

Note: useDiffPanelGitActions (stageAll/revertAll) is correct — it receives its path
from ChatDiffPane → DiffPanel, which is already the resolved working path via
buildDiffSection. ✓

### 5. ChatDiffPane label accuracy

MINOR | src/renderer/src/features/chat/components/ChatDiffPane.tsx:17-19 | When
projectPath is null (no project opened), label shows "Opened checkout" |
Semantically misleading since there is no checkout, but the panel wouldn't have diff
content anyway, so it's cosmetic. A label like "No project" would be more precise. |
Guard: section.projectPath === null ? null : worktreeLabel === null ? 'Opened
checkout' : ....

### ADR accuracy

The ADR's revised text is substantially correct on the architecture and its
limitations. One claim is not yet delivered:

MAJOR | docs/adr/0018-session-keyed-git-state.md Staging step 1 | "every renderer
git read/write routed through the resolver" | Header commit, branch picker checkout,
and action dialog branch-create are not routed — they still use
useProject().projectPath. The ADR's own Consequences section ("Stage / Revert /
Commit change target") is only partially satisfied: Stage and Revert are correct,
but Commit from the Header and branch mutations from the composer are not. | Either
route the remaining callers (fixing the BLOCKERs above) or narrow the ADR claim to
match reality.

### Summary

┌──────────┬────────────────────────────────────────────────────────────────┐
│ Severity │ Count                                                          │
├──────────┼────────────────────────────────────────────────────────────────┤
│ BLOCKER  │ 1 (Header commit targets wrong tree)                           │
├──────────┼────────────────────────────────────────────────────────────────┤
│ MAJOR    │ 4 (Header refresh, 2 composer branch mutations, ADR overclaim) │
├──────────┼────────────────────────────────────────────────────────────────┤
│ MINOR    │ 2 (no eviction, null-project label)                            │
└──────────┴────────────────────────────────────────────────────────────────┘

The core architecture — map-keyed store, selector, useActiveWorkingPath,
working-path-routed refresh, broadcast subscription, buildDiffSection — is well
designed and correctly implemented. The remaining gap is that three mutation call
sites outside the diff-panel flow still pass the project path to destructive
operations, which is exactly the class of bug the ADR exists to eliminate.
