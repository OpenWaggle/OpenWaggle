---
title: "Git Integration"
description: "Built-in git features: live diff stats, run target and session environment mode, the diff panel with review comments, staged git actions, commit, and the terminal."
order: 1
section: "Developer Workflow"
---

OpenWaggle includes built-in git features so you can review and manage version control without leaving the app.

## Live Diff Stats

The header bar shows real-time git statistics for the active session's working tree:

- **Green** `+N` — Lines added.
- **Red** `-N` — Lines deleted.

Stats refresh automatically when:

- You switch projects or sessions.
- A commit completes.
- The agent finishes a turn (a short debounce after the agent stops editing).
- The window regains focus.
- Another window changes the same working tree.
- You click **Refresh** in the commit dialog.

Click the diff stats to toggle the diff panel.

> The diff panel's own **Refresh diff** button re-fetches the diff only; it does not recompute the header's `+N` / `-N`.

## Session-Aware Git State

Git state is keyed to the **working tree the active session actually runs in**, not just the folder you opened:

- **Current checkout** (`local`) — the session edits files directly in the checkout you opened.
- **New worktree** (`worktree`) — the session runs in its own isolated worktree. The diff panel, the run target, and the git actions all target that worktree, so you review the work the agent is really doing.

The diff panel header names the tree it is showing, beside **Changes**:

- **`Worktree · <name>`** — the session has its own worktree.
- **Opened checkout** — the session runs in the folder you opened.

Each session in the sidebar carries its own git indicator, so two sessions on two different worktrees show their own dirty / ahead / behind state independently.

Branch and worktree **lists** are repository-level (a linked worktree shares refs with the primary checkout), while status, diffs, and working-tree actions follow the session's working tree.

### Choosing where a session runs

The row below the composer starts with a **Run in** selector offering **Current checkout** and **New worktree**. It appears only while the session still has no worktree — that is, before the first message — because after the worktree exists there is nothing left to choose. It overrides the global default set in Settings → Worktrees (shipped default: **Current checkout**).

In **New worktree** mode the first send needs a base branch. Until one resolves, sending is refused with:

> Select a base branch before sending in worktree mode.

Session worktrees are created outside your project, at `~/.openwaggle/worktrees/<repository>/<sessionId>`, on a branch named `ow/session-<short-session-id>`. You can list and remove them in Settings → Worktrees.

### Recovering a missing worktree

If a session's worktree has been deleted outside OpenWaggle, sending is **blocked** rather than silently redirected — a fresh tree would not contain the session's work:

> This session's worktree no longer exists. Recreate it, or switch this session to the current checkout.

The same row then offers two explicit choices:

- **Recreate worktree** — reattaches the session's own branch in a new worktree, preserving its commits.
- **Use current checkout** — switches the session to the opened checkout.

## Run Target

The right-hand side of the row below the composer shows the ref the next send will use — the checked-out branch in Current-checkout mode, or the worktree's branch (or chosen base ref, before the worktree exists) in New-worktree mode. Click it to open the picker.

- **Search branches** — Filter local and remote branches by name.
- **Click a branch** — In Current-checkout mode this checks the branch out. In New-worktree mode it instead records that branch as the **base ref** the worktree will be created from; nothing is checked out.
- **New branch…** — Create a branch from the working tree's current `HEAD` and check it out.
- **Copy branch name** — Copy the selected ref to the clipboard.

In New-worktree mode the picker also offers:

- **Start from origin** — Base the worktree on the matching `origin/` ref instead of your local ref.
- **Checkout change request…** — Pick an open pull/merge request from the list to check out its head ref.

Branch **administration** — rename, delete, and set-upstream — is intentionally not here. Those are destructive or history-changing operations that do not answer "what does my next send run on"; ask the agent to do them (so the change is reviewable in the transcript and diff) or use the [built-in terminal](#built-in-terminal).

## Diff Panel

Toggle the diff panel with `Cmd+D` / `Ctrl+D` or by clicking the diff stats in the header. It appears in the right sidebar and is resizable by dragging its edge (360–900 px, remembered between launches).

The diff panel and the [Session Tree](/docs/using-openwaggle/session-tree) share the same right-sidebar slot, so opening one closes the other.

### Diff Scope

Tabs at the top choose what you are reviewing:

- **Working tree** — Uncommitted changes in the session's working tree.
- **Branch** — Changes on `HEAD` relative to the merge base with a base ref. The default option, **Automatic**, resolves the repository's default branch — the one `origin/HEAD` advertises, preferring the remote-tracking copy so it reflects what you would open a change request against. Pick a specific ref from the dropdown to override it. In a fresh repository with no remote and no default branch to resolve, this falls back to the working-tree diff.
- **Turns** — Per-turn diffs, shown only once the session has captured turn checkpoints. The dropdown lists each turn with its `+`/`−` counts.

### Reading Diffs

- **Changed-file navigator** — A tree docked on the right of the diff, with per-file status letters (`A` / `M` / `D`) and add/remove counts, grouped by directory. Drag its edge to resize, or focus the resize handle and use `ArrowLeft` / `ArrowRight`.
- **Unified or split view** — Toggle between a single column and side-by-side columns.
- **Wrap long lines** — Toggle soft-wrapping of long lines.
- **Syntax highlighting** — Code is syntax-highlighted; choose the theme in Settings → Appearance.
- **Added lines** in green, **removed lines** in red, with git's standard three lines of surrounding context.

### Review Comments

The diff panel is a review surface, not just a viewer. Click a line — or select a range of lines — to open a comment box with two ways to send:

- **Add comment** — Sends that single comment to the agent immediately.
- **Start a review** (or **Add to review** once a review is open) — Adds the comment to a batch instead of sending it.

While a review is open, a bar shows `N pending comments` with:

- **Submit review** — Expands a confirmation with an optional **Overall instructions** box, then **Send to agent · N pending comments** delivers the whole batch as one review.
- **Discard review** — Drops the pending comments.

`Cmd/Ctrl+Enter` submits a comment or the review; `Escape` cancels.

### Staged Git Actions

The bottom bar's primary button adapts to the state of your working tree, upstream, and remote. Depending on that state it reads **Commit**, **Commit & push**, **Commit, push & PR** (**MR** on GitLab), **Push**, **Push & create PR**, **Create PR**, **View PR**, **Pull**, **Publish repository**, or **Sync ref**.

- Actions that include a commit open a commit-message dialog first.
- Pushing a new branch names it automatically from your changes.
- If the target is the repository's **default branch**, a confirmation dialog appears before anything is committed or pushed.
- Progress is reported per stage (for example "Generating commit message…", "Pushing to `<target>`…", "Creating pull request…").

### Stage All / Revert All

Also in the bottom bar, from the working-tree view:

- **Stage all** — Stage every modified, added, deleted, and untracked path across the repository.
- **Revert all** — Restore tracked and staged changes to `HEAD` and delete untracked files. This is destructive and asks for confirmation first:

  > This resets all tracked and staged changes to HEAD and permanently deletes untracked files and folders. Ignored files and nested Git repositories are kept. If either would obstruct restoring HEAD, nothing is changed. This cannot be undone.

  Ignored files and nested Git repositories (including submodules) are preserved. If restoring `HEAD` would require destroying such retained content, the revert refuses and changes nothing.

## Commit Dialog

Click the **Commit** button in the header to open the commit dialog.

1. **Changed files list** — Every modified, added, deleted, renamed, copied, and untracked path, colour-coded by status with `+N / -N` counts.
2. **File selection** — Check/uncheck files to include; only selected files are staged.
3. **Commit message** — Multi-line text area.
4. **Amend last commit** — Amend the previous commit instead of creating a new one.
5. **Refresh** — Re-scan the working tree (this also refreshes the header diff stats).

On success a toast confirms the commit and the diff stats refresh. In New-worktree mode the commit lands in the session's worktree, leaving the opened checkout untouched.

Error states are shown inline, for example "No changes are available to commit." or "A merge is in progress. Resolve it before committing."

## Built-in Terminal

Toggle the terminal with `Cmd+J` / `Ctrl+J` or the terminal button in the header.

The terminal is a full terminal emulator:

- Supports standard terminal features (colors, cursor positioning, etc.).
- Closing the terminal ends its shell session; opening it again starts a fresh shell.
- It always runs in the project directory you opened — **including for New-worktree sessions**, so commands you type there do not act on the session's worktree unless you `cd` into it first.

Use it for git operations not covered by the built-in UI (such as branch rename, delete, or upstream configuration), or for running tests, builds, and other commands directly.
