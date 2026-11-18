# Remove Git Branch Administration From The Composer

Status: accepted

OpenWaggle's composer no longer offers Rename, Delete current, Set upstream, or per-branch delete. The composer row is a **run-target chooser**, not a repository administration console. This records why pre-existing, user-visible behaviour was deleted rather than moved, so a future reader does not go looking for it.

Amended 2026-08-26: the run-target chooser is now selection-only. Search and selection of existing refs remain; create-and-switch, copy-name, start-from-origin, and change-request checkout were removed from this popover so it answers exactly one question.

## Context

Before this change the composer's branch popover offered, one click from the message box:

- `Create`
- `Rename`
- `Delete current`
- `Upstream` (set upstream tracking)
- a trash icon on every local branch row

Alongside it sat a separate `Options` popover whose trigger showed the worktree base ref. Two controls in the same row each displayed a branch string, and neither indicated which one governed the next send. That ambiguity was what a user reported, and interrogating it surfaced the deeper question: should branch administration be there at all?

This surface was **pre-existing**, not introduced by the diff-panel work. It first appears in `64511c98 refactor: reorganize renderer by feature` and exists unchanged at the merge-base `34d955ed`.

### What the reference implementation did at the first decision

The established behaviour for this control is a ref chooser with **no** branch management. In the mature implementation studied for this work, the equivalent selector runs to 845 lines and grepping it for `rename|deleteBranch|delete current|setUpstream|upstream` returns **0 matches**. Its entire action set is:

- `"Search refs..."`
- switch ref
- create-and-switch
- `"Copy branch name"`
- `"Start worktree from origin"`
- `checkoutPullRequestItemValue` (checkout a change request)

Every one of those answers "what does this run use?". None of them mutates repository history or remote configuration.

That reference was useful for removing branch administration, but it still mixed selection with four secondary actions. The 2026-08-26 amendment adopts the narrower Codex composer boundary: this popover only selects an existing ref.

### Why the actions are a poor fit for the composer

1. **Wrong question.** The row exists to answer *"which ref does my next send run on?"*. Renaming a branch, deleting one, or rewiring upstream tracking answers none of it.
2. **Destructive operations at the highest-traffic click target.** `Delete current` and a per-row trash icon sit adjacent to Send, in a UI whose whole purpose is rapid iteration. `git branch -d` on a branch whose work is not merged is not recoverable through this UI.
3. **The agent is the better executor.** Branch cleanup asked of the agent is reviewable: it appears in the transcript, its diff shows up in the panel, and the turn is checkpointed. The same action taken via a chip is invisible after the toast fades.
4. **Cost without demand.** Nothing in issue #30 asked for it, and the surface carried its own IPC channels, main-process handlers, payload schemas, action-dialog kinds, and tests — all of which had to be kept correct.

## Decision

**Delete Rename, Delete current, Set upstream, and per-branch delete end to end.** Not hidden, not relocated: removed, including the transport beneath them, so no orphaned channels or dead handlers remain.

Removed in `c92818b0`:

| Layer | Removed |
| --- | --- |
| main | `renameGitBranch`, `deleteGitBranch`, `setGitBranchUpstream` and their Effect handlers |
| main | `branchRenamePayloadSchema`, `branchDeletePayloadSchema`, `branchSetUpstreamPayloadSchema` |
| IPC | `git:branches:rename`, `git:branches:delete`, `git:branches:set-upstream` and their typed contracts |
| preload | the three `api` methods, and their entries in the preload method-contract test |
| shared | `GitBranchRenamePayload`, `GitBranchDeletePayload`, `GitBranchSetUpstreamPayload` |
| renderer | `BranchPickerActions`, the per-row trash button, the three git-store actions, their `useGit` bindings, the `rename-branch`/`delete-branch`/`set-upstream` action-dialog kinds and their mutations |

Net effect: 26 files, +21/−704.

**Keep two composer branch operations**, because they are the run-target choice:

- `listGitBranches` — populates the ref chooser and the diff panel's base-ref choices.
- `checkoutGitBranch` — selecting a ref in `local` mode *is* a checkout.

`createGitBranch` remains a shared Git capability for other workflows, but the composer no longer presents it. Creating a branch is a second task, not selecting an existing run target.

**Consolidate the two branch controls into one ref chooser** (`a743b0b1`). The row keeps project, environment, and run target as separate choices. Selecting a ref checks it out in `local` mode and sets the worktree base ref in `worktree` mode — the same control, resolving to whatever the mode makes it mean. The picker contains only search and the existing ref list.

**Keep environment and ref as separate first-send decisions.** Before launch, the environment control answers where the agent works and the ref chooser answers which branch or base ref it uses. Pressing Send freezes both controls and collapses the setup dock out of the composer. Worktree creation leaves a compact trace in the transcript; the composer does not retain a read-only branch toolbar or expose post-launch branch management beside later prompts.

## Consequences

- **A capability is genuinely gone.** Renaming a branch, deleting one, or setting upstream now requires the terminal, the agent, or another Git client. This is accepted deliberately: OpenWaggle is a coding-agent UI, not a Git GUI.
- **No orphaned transport.** Verified by grep that `renameGitBranch|deleteGitBranch|setGitBranchUpstream` and the three channel names appear nowhere in `src/`. `sessions:rename-branch` survives and is unrelated — it renames a *conversation* branch.
- **Tests follow the visible boundary.** The picker keeps coverage for search, filtering, selected-ref state, and local/worktree selection semantics; a regression test asserts the removed secondary actions stay absent.
- **One branch string on screen.** `SessionContextRow` now owns only the environment mode, and a regression test asserts it renders nothing that names a ref.
- **One purpose in the open picker.** Every interactive row selects an existing ref; no footer action changes the task from selection to branch creation, copy, worktree policy, or change-request checkout.
- **Reversible if wrong.** The removed code is one `git revert` away in history, and the argument above is falsifiable: if users ask for branch administration, the right answer is a deliberate repository surface (sidebar or command palette), not a chip beside Send.

## Alternatives considered

**Relocate to the project sidebar's branch context menu.** Rejected for now: it preserves destructive operations we have no evidence anyone wants, and it would be built speculatively. Cheap to add later if demand appears, and the sidebar is the correct home if it does.

**Hide behind a "Manage branches…" entry inside the ref chooser.** Rejected: it keeps every line of IPC, handler, schema, and test while making the feature harder to find — the worst of both. Hiding a surface is not the same as deciding about it.

**Keep it, and only fix the two-control ambiguity.** Rejected: this addresses the reported symptom and leaves the cause. The row would still put `Delete current` one click from Send.
