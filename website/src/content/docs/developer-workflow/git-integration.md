---
title: "Git Integration"
description: "Built-in git features: live diff stats, run-target chooser, session-aware git state, the diff panel with review comments, stage/revert/commit, and the terminal."
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
- You click the refresh button.

Click the diff stats to toggle the diff panel.

## Session-Aware Git State

Git state is keyed to the **working tree the active session actually runs in**, not just the folder you opened:

- **Local mode** — the session runs in the checkout you opened. The git surface targets that checkout.
- **Worktree mode** — the session runs in its own isolated worktree. The diff panel, run-target chip, and Stage / Revert / Commit all target that worktree, so you review the work the agent is really doing.

The run-target chip below the composer labels the target:

- **`Worktree · <name>`** — the session has its own worktree.
- **Opened checkout** — the session runs in the folder you opened.

Each session in the sidebar carries its own git indicator, so two sessions on two different worktrees show their own dirty/ahead state independently.

Branch, worktree, and remote **lists** are repository-level (a linked worktree shares refs with the primary checkout), while status, diffs, and working-tree actions follow the session's working tree.

### Recovering a missing worktree

If a session's worktree has been deleted outside OpenWaggle, sending a message is **blocked** rather than silently redirected — a fresh tree would not contain the session's work. You are offered two explicit choices:

- **Recreate worktree** — reattaches the session's own branch in a new worktree, preserving its history.
- **Use current checkout** — switches the session to local mode, running in the folder you opened.

## Run Target (Composer Branch Row)

The row below the composer answers one question: **which ref does my next send run on?** Click the ref name to open the picker.

- **Search branches** — Filter local and remote branches by name.
- **Switch** — Click any branch to check it out for this session's working tree.
- **New branch…** — Create a new branch from the current ref and switch to it.
- **Copy branch name** — Copy the selected ref to the clipboard.

In worktree mode the picker also offers:

- **Start from origin** — Base the worktree on the origin ref instead of your local ref.
- **Checkout change request…** — Check out a pull/merge request by number.

Branch **administration** — rename, delete, and set-upstream — is intentionally not in this row. Those are destructive or history-changing operations that do not answer "what does my next send run on"; ask the agent to do them (so the change is reviewable in the transcript and diff) or use the [built-in terminal](#built-in-terminal).

## Diff Panel

Toggle the diff panel with `Cmd+D` / `Ctrl+D` or by clicking the diff stats in the header. It appears to the right of the chat area.

### Diff Scope

Tabs at the top choose what you are reviewing:

- **Working tree** — Uncommitted changes in the session's working tree.
- **Branch** — Changes against a base ref. The dropdown defaults to **Automatic** (a sensible base) or you can pick a specific ref.
- **Turns** — Per-turn diffs, shown only once the session has captured turn checkpoints. The dropdown lists each turn with its `+`/`−` counts.

### Reading Diffs

- **File tree navigator** — A resizable tree on the left with per-file status icons, add/remove counts, and directory grouping. Drag its edge to resize.
- **Unified or split view** — Toggle between a single column and side-by-side columns.
- **Wrap long lines** — Toggle soft-wrapping of long lines.
- **Syntax highlighting** — Code is syntax-highlighted; choose the theme in Settings → Appearance.
- **Added lines** in green, **removed lines** in red, unchanged context collapsed with expand controls.

### Review Comments

The diff panel is a review surface, not just a viewer. Click a line to leave an inline comment. While a review is in progress, a bar shows the comment count and lets you **Send to agent** — optionally with overall instructions — delivering all your comments to the agent as a single review so it can act on your feedback in the next turn.

### Stage All / Revert All

From the diff panel's working-tree view:

- **Stage all** — Stage every modified, added, and deleted path across the repository.
- **Revert all** — Restore tracked and staged changes to `HEAD` and delete untracked files. This is destructive and asks for confirmation first:

  > This resets all tracked and staged changes to HEAD and permanently deletes untracked files and folders. Ignored files and nested Git repositories are kept. If either would obstruct restoring HEAD, nothing is changed. This cannot be undone.

  Ignored files and nested Git repositories (including submodules) are preserved. If restoring `HEAD` would require destroying such retained content, the revert refuses and changes nothing.

## Commit Dialog

Click the **Commit** button in the header to open the commit dialog.

1. **Changed files list** — All modified, added, deleted, and renamed files with status icons.
2. **File selection** — Check/uncheck files to include; only selected files are staged.
3. **Commit message** — Multi-line text area.
4. **Amend option** — Amend the previous commit instead of creating a new one.
5. **Refresh** — Re-scan the working tree.

On success a toast confirms the commit and the diff stats refresh. In worktree mode the commit lands in the session's worktree, leaving the opened checkout untouched. Error states are shown inline (e.g. "No staged changes", "Merge in progress").

## Built-in Terminal

Toggle the terminal with `Cmd+J` / `Ctrl+J` or the terminal button in the header.

The terminal is a full terminal emulator:

- Runs in your project directory.
- Supports standard terminal features (colors, cursor positioning, etc.).
- Persists across terminal toggles within the same session.

Use it for git operations not covered by the built-in UI (such as branch rename, delete, or upstream configuration), or for running tests, builds, and other commands directly.
