---
title: "Git integration"
description: "Review the agent's file changes, send corrections, and commit or push from the session's working directory."
order: 3
section: "Using OpenWaggle"
---

The agent's file edits happen on disk. Use the diff panel to review what changed before you commit or push. Opening the diff does not approve or apply edits; they have already been made.

For a first review:

1. Open the session and press `Cmd+D` on macOS or `Ctrl+D` on Windows and Linux.
2. Check the working-directory label, then select **Working tree** for uncommitted changes.
3. Choose a file and read its diff. Changes from you or another session in the same checkout also appear here.
4. Click a changed line, write a correction, and choose **Add comment** to send it to the agent.
5. Review the updated files and test results. Commit only when you are satisfied.

Use [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees) to choose where a new session works. The sections below cover the full Git controls and recovery behavior.

## Live diff stats

The header bar shows real-time git statistics for the active session's working tree:

- Green `+N` counts added lines.
- Red `-N` counts deleted lines.

Stats refresh automatically when:

- You switch projects or sessions.
- A commit completes.
- The agent finishes a turn, after a short debounce.
- The window regains focus.
- Another window changes the same working tree.
- You click **Refresh** in the commit dialog.

Click the diff stats to toggle the diff panel.

After the first message, you can also open **Changes** from [Session Summary](/docs/using-openwaggle/session-summary). Its Environment section shows the working directory, branch, and commit, push, and review-request actions.

> The diff panel's own **Refresh diff** button re-fetches the diff only; it does not recompute the header's `+N` / `-N`.

## Session-aware Git state

Git state is keyed to the **working tree the active session actually runs in**, not just the folder you opened:

- **Current checkout** edits files directly in the folder you opened.
- **New worktree** uses a separate checkout. The diff panel, selected Git ref, and Git actions all use that worktree.

The diff panel header names the tree it is showing, beside **Changes**:

- **`Worktree · <name>`** means the session has its own worktree.
- **Opened checkout** means it uses the folder you opened.

Each session in the sidebar carries its own git indicator, so two sessions on two different worktrees report their own state independently.

The row shows commits ahead of and behind upstream, such as `↑2` and `↓1`. Hover the branch icon for its name. Use the diff panel to see uncommitted files; the sidebar does not count them.

Branch and worktree **lists** are repository-level (a linked worktree shares refs with the primary checkout), while status, diffs, and working-tree actions follow the session's working tree.

### Choosing where a session runs

The context row at the top of the composer has separate controls for the environment and Git ref. The environment selector offers **Current checkout** and **New worktree**. The branch control stays separate, so choosing an environment never hides or changes the meaning of the selected ref.

You can edit both composer controls before the first message. They become read-only after the session starts. The environment selector overrides the global default in **Settings > Worktrees**. The shipped default is **Current checkout**.

The branch picker in **Session Summary > Environment** remains available for an existing session. Checking out a branch there changes the files used by every session sharing that checkout.

Before a Current-checkout session's first agent run, OpenWaggle attempts `git pull --ff-only` from the checked-out branch's upstream. A failed pull does not block the task. Later turns do not pull automatically. Review unrelated work before the first send because a successful pull updates the checkout.

For a new worktree based on a local branch, OpenWaggle first tries to fetch that branch from `origin`. It starts from `origin/<branch>` when the local branch is equal to or behind that tip. By default, ahead or diverged local branches retain their own tip. Fetch failure falls back to the available refs. Already remote-qualified refs are used as selected.

In **New worktree** mode the first send needs a base branch. Until one resolves, sending is refused with:

> Select a base branch before sending in worktree mode.

Session worktrees are created outside your project, at `~/.openwaggle/worktrees/<repository>/<sessionId>`, on a branch named `ow/session-<sessionId>`, using the same identifier as the directory. Worktrees created before this naming change keep their older, shortened name; **Recreate worktree** reattaches to it rather than starting a new branch, so commits made in the old tree are not stranded. You can list and remove them in **Settings > Worktrees**.

### First-send worktree feedback

When the first message creates a worktree, OpenWaggle reports Git checkout progress before the agent starts:

1. **Preparing workspace** resolves the requested base ref and target path.
2. **Checking out files** runs the Git worktree operation.
3. **Worktree created** confirms that the isolated checkout exists.
4. **Starting task** sends your submitted message to the agent.

While setup runs, the transcript shows a **Creating a worktree** card with **More details**, **Work locally**, and **Cancel**. **Work locally** stops the in-flight setup, changes that session to Current checkout, and retries the same submitted turn once. **Cancel** removes the optimistic turn and restores its text, attachments, skill reference, and Waggle preset to the composer.

If checkout creation fails, the card keeps the submitted turn visible and adds **Retry**. The details disclose the Git operation and error instead of replacing it with a generic spinner. Once the agent starts, the large card becomes a small expandable **Worktree created** row. That row remains in the transcript after reload as a record of where the session began. Local sessions and cancelled worktree launches do not get that row.

A configured preparation profile adds **Workspace setup** after checkout creation. Setup must succeed before the first agent turn. A failed or review-blocked setup has its own output and controls in **Session Summary > Workspace preparation**, including **Retry setup**, **Review changes**, and **Continue anyway** where applicable. Development servers belong in on-demand Project actions, not setup. See [Workspace preparation](/docs/developer-workflow/built-in-terminal#workspace-preparation).

### Recovering a missing worktree

If a session's worktree has been deleted outside OpenWaggle, OpenWaggle blocks sending rather than silently choosing another folder. A fresh checkout would not contain the session's uncommitted work:

> This session's worktree no longer exists. Recreate it, or switch this session to the current checkout.

The same row then offers two explicit choices:

- **Recreate worktree** reattaches the session's branch in a new worktree, preserving its commits. It cannot recover uncommitted files deleted with the old worktree. The preparation profile snapshot is retained, but old setup completion and exported environment are cleared for the replacement checkout.
- **Use current checkout** switches the session to the opened checkout.

## Run target

The right-hand side of the composer context row shows the run target. In Current-checkout mode this is the checked-out branch. In New-worktree mode it is the chosen base ref before creation, then the worktree branch.

Before the first message, click the ref to open the picker:

- Type in **Search branches** to filter local and remote branches.
- Select a branch to check it out in Current-checkout mode. In New-worktree mode, this chooses the base for the new worktree without checking anything out yet.

After the session starts, that composer control is read-only. Use the branch row in **Session Summary > Environment** to check out an existing branch, create one from an unmatched search, or choose **Copy branch name**.

To rename or delete a Git branch or set its upstream, use the [built-in terminal](#built-in-terminal) or ask the agent to run the specific Git command. These actions are not in the composer picker.

## Diff panel

Toggle the diff panel with `Cmd+D` / `Ctrl+D` or by clicking the diff stats in the header. It appears in the right sidebar. Drag its edge to resize between 360 and 900 px; the width is remembered between launches.

The diff panel and the [Session Tree](/docs/using-openwaggle/session-tree) share the same right-sidebar slot, so opening one closes the other.

### Diff scope

Tabs at the top choose what you are reviewing:

- **Working tree** shows uncommitted changes in the session's working tree.
- **Branch** shows changes on `HEAD` relative to the merge base with a base ref. The default option, **Automatic**, resolves the repository's default branch and then names it, so the label reads `Automatic · origin/main` once the diff has loaded. Resolution asks the remote, in this order:
  1. `origin/HEAD`, the remote-tracking symref a clone sets up;
  2. the remote directly, when that symref is missing locally;
  3. a conventional `main` or `master` that exists locally, used only when the remote named nothing at all.

  It prefers the remote-tracking copy (`origin/main` over a local `main`) so the comparison reflects what you would open a change request against. When the remote does name a branch, only that branch is used: OpenWaggle will not quietly compare against a conventional `main` that merely happens to exist. `init.defaultBranch` is deliberately not consulted: it describes how *new* repositories are initialised, and it is usually read from your global git config, so it says nothing about this repository.

  Pick a specific ref from the dropdown to override it; a stored ref that no longer exists is shown as `(unavailable)` rather than silently reverting to Automatic. If no base resolves, such as in a fresh repository without a remote or conventional default branch, the panel falls back to the working-tree diff and says so.

  If you are already sitting on the default branch, `HEAD` and the base are the same commit, so the Branch tab shows no changes; use **Working tree** to review uncommitted work there.
- **Turns** shows changes captured during individual agent turns, when those checkpoints are available. The dropdown lists each turn with its `+`/`−` counts.

### Reading diffs

Use the changed-file tree on the right to select a file. It groups files by directory and shows status letters such as `A`, `M`, and `D`, plus added and removed line counts. Drag its edge to resize, or focus the resize handle and use `ArrowLeft` / `ArrowRight`.

Switch between unified and side-by-side views, and turn on line wrapping for long lines. Choose the syntax theme in **Settings > Appearance**. Added lines are green and removed lines are red, with Git's usual three lines of surrounding context.

### Review comments

Click a line or select a range of lines to open a comment box:

- **Add comment** sends that comment to the agent immediately.
- **Start a review** saves the comment in a batch without sending. After the first comment, the action becomes **Add to review**.

While a review is open, a bar shows `N pending comments` with:

- **Submit review** opens a confirmation with optional **Overall instructions**. Choose **Send to agent · N pending comments** to send the batch.
- **Discard review** drops the pending comments.

`Cmd/Ctrl+Enter` submits a comment or the review; `Escape` cancels.

### Staged Git actions

The bottom bar's primary button adapts to the state of your working tree, upstream, and remote. Depending on that state it reads **Commit**, **Commit & push**, **Commit, push & PR** (**MR** on GitLab), **Push**, **Push & create PR**, **Create PR**, **View PR**, **Pull**, **Publish repository**, or **Sync ref**.

- Actions that include a commit open a commit-message dialog first. Enter the message yourself; this flow does not generate it.
- Actions that create a feature branch prepare a branch name before pushing. Check the proposed target rather than assuming a push will create the branch you want.
- If the target is the repository's **default branch**, a confirmation dialog appears before anything is committed or pushed.
- Progress is reported for each step, such as committing, pushing, and creating the review request.

In Session Summary, **Commit or push** is separate from **Create PR** or **Create MR**. Committing there does not also create a review request. Request creation uses `gh` for GitHub or `glab` for GitLab and checks authentication for the remote's exact host before changing branches, committing, or pushing. If the CLI is unavailable or unauthenticated, the form disables creation inside OpenWaggle and offers a browser fallback where supported. See [Creating a pull or merge request](/docs/using-openwaggle/session-summary#creating-a-pull-or-merge-request).

### Stage all / Revert all

Also in the bottom bar, from the working-tree view:

- **Stage all** stages every modified, added, deleted, and untracked path across the repository.
- **Revert all** restores tracked and staged changes to `HEAD` and deletes untracked files. This is destructive and asks for confirmation first:

  > This resets all tracked and staged changes to HEAD and permanently deletes untracked files and folders. Ignored files and nested Git repositories are kept. If either would obstruct restoring HEAD, nothing is changed. This cannot be undone.

  Ignored files and nested Git repositories (including submodules) are preserved. If restoring `HEAD` would require destroying such retained content, the revert refuses and changes nothing.

## Commit dialog

Click **Open commit dialog** in the header. Hover the icon to see its label.

1. Review the changed-files list and its status and line counts.
2. Check the files to include. Only selected files are staged.
3. Enter your commit message.
4. Choose **Amend last commit** only if you intend to replace the previous commit rather than create a new one.
5. Use **Refresh** if files changed while the dialog was open. This also refreshes the header's diff stats.

On success a toast confirms the commit and the diff stats refresh. In New-worktree mode the commit lands in the session's worktree, leaving the opened checkout untouched.

Error states are shown inline, for example "No changes are available to commit." or "A merge is in progress. Resolve it before committing."

## Built-in terminal

Toggle the terminal with `Cmd+J` / `Ctrl+J` or the terminal button in the header.

New terminals start in the active session's Working path: the Session worktree in New-worktree mode
or the opened checkout in Current-checkout mode. Commands therefore act on the same working tree as
the agent and the diff panel by default.

A terminal opened in a draft exists before its Session worktree does. On first send OpenWaggle keeps
that shell alive and moves its ownership, layout, and scrollback into the new session. If the send
creates a worktree, the inherited pane remains visibly labelled **Original checkout**; new terminals
use the worktree. Choose **Restart in worktree** to stop the inherited process and relaunch that pane
in the session's Working path.

Hiding the panel does not stop its shells. Closing a pane or tab does, and active or uncertain
processes receive an impact confirmation first. See
[Built-in Terminal](/docs/developer-workflow/built-in-terminal) for tabs, splits, contextual
shortcuts, persistence, shell startup, links, and selection-to-chat.

Use the terminal for Git operations not covered by the built-in UI (such as branch rename, delete,
or upstream configuration), or for running tests, builds, and other commands directly.
