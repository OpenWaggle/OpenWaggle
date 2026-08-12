# Remove Git Branch Administration From The Composer

Status: accepted

OpenWaggle's composer no longer offers Rename, Delete current, Set upstream, or per-branch delete. The composer row is a **run-target chooser**, not a repository administration console. This records why pre-existing, user-visible behaviour was deleted rather than moved, so a future reader does not go looking for it.

## Context

Before this change the composer's branch popover offered, one click from the message box:

- `Create`
- `Rename`
- `Delete current`
- `Upstream` (set upstream tracking)
- a trash icon on every local branch row

Alongside it sat a separate `Options` popover whose trigger showed the worktree base ref. Two controls in the same row each displayed a branch string, and neither indicated which one governed the next send. That ambiguity was what a user reported, and interrogating it surfaced the deeper question: should branch administration be there at all?

This surface was **pre-existing**, not introduced by the diff-panel work. It first appears in `64511c98 refactor: reorganize renderer by feature` and exists unchanged at the merge-base `34d955ed`.

### What the reference implementation does

The parity target for this work is T3Code. Its equivalent control, `BranchToolbarBranchSelector.tsx` (845 lines), has **zero** branch management. Grepping it for `rename|deleteBranch|delete current|setUpstream|upstream` returns **0 matches**. Its entire action set is:

- `"Search refs..."`
- switch ref
- create-and-switch
- `"Copy branch name"`
- `"Start worktree from origin"`
- `checkoutPullRequestItemValue` (checkout a change request)

Every one of those answers "what does this run use?". None of them mutates repository history or remote configuration.

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

**Keep three branch operations**, because each one answers the run-target question:

- `listGitBranches` — populates the ref chooser and the diff panel's base-ref choices.
- `checkoutGitBranch` — selecting a ref in `local` mode *is* a checkout.
- `createGitBranch` — creating a branch in order to run on it is a run-context decision. T3Code keeps create-and-switch for the same reason.

**Consolidate the two controls into one ref chooser** (`a743b0b1`). The row is now `Run in [mode]` on the left and a single run-target picker on the right. Selecting a ref checks it out in `local` mode and sets the worktree base ref in `worktree` mode — the same control, resolving to whatever the mode makes it mean. The `Options` popover is gone; search, ref list, create-and-switch, copy name, start-from-origin, and checkout-change-request all live in the one popover.

## Consequences

- **A capability is genuinely gone.** Renaming a branch, deleting one, or setting upstream now requires the terminal, the agent, or another Git client. This is accepted deliberately: OpenWaggle is a coding-agent UI, not a Git GUI.
- **No orphaned transport.** Verified by grep that `renameGitBranch|deleteGitBranch|setGitBranchUpstream` and the three channel names appear nowhere in `src/`. `sessions:rename-branch` survives and is unrelated — it renames a *conversation* branch.
- **Test count moved, not shrunk.** Cases covering deleted behaviour were removed; cases covering behaviour that *moved* (base-ref selection, start-from-origin, change-request checkout) moved to `RunTargetPicker.component.test.tsx`. The component suite went 516 → 519.
- **One branch string on screen.** `SessionContextRow` now owns only the environment mode, and a regression test asserts it renders nothing that names a ref.
- **Reversible if wrong.** The removed code is one `git revert` away in history, and the argument above is falsifiable: if users ask for branch administration, the right answer is a deliberate repository surface (sidebar or command palette), not a chip beside Send.

## Alternatives considered

**Relocate to the project sidebar's branch context menu.** Rejected for now: it preserves destructive operations we have no evidence anyone wants, and it would be built speculatively. Cheap to add later if demand appears, and the sidebar is the correct home if it does.

**Hide behind a "Manage branches…" entry inside the ref chooser.** Rejected: it keeps every line of IPC, handler, schema, and test while making the feature harder to find — the worst of both. Hiding a surface is not the same as deciding about it.

**Keep it, and only fix the two-control ambiguity.** Rejected: this addresses the reported symptom and leaves the cause. The row would still put `Delete current` one click from Send.
