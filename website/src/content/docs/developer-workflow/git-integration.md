---
title: "Git Integration"
description: "Built-in git features including live diff stats, Git branch management, commit dialog, diff panel, and terminal."
order: 1
section: "Developer Workflow"
---

OpenWaggle includes built-in git features so you can manage version control without leaving the app.

## Live Diff Stats

The header bar shows real-time git statistics for your project:

- **Green** `+N` — Lines added.
- **Red** `-N` — Lines deleted.

Stats update automatically when:
- You switch projects or sessions.
- A commit completes.
- You click the refresh button.
- The agent modifies files.

Click the diff stats to toggle the diff panel.

## Git Branch Management

This section covers repository Git branches. Pi session branches are Pi runtime branches inside OpenWaggle sessions; use the [Session Tree](/docs/using-openwaggle/session-tree) for those.

Click the **branch name** in the branch row below the composer to open the branch picker.

### Branch Picker Features

- **Search** — Filter branches by name.
- **Local branches** — All local branches listed.
- **Remote branches** — Remote tracking branches listed separately.
- **Current branch** — Highlighted with an indicator.
- **Branch operations**:
  - **Switch** — Click any branch to check it out.
  - **Create** — Create a new branch from the current HEAD.
  - **Rename** — Rename the current branch.
  - **Delete** — Delete a local branch.
  - **Set upstream** — Configure the tracking remote for the current branch.

Branch operations show success/error feedback and automatically refresh the branch list and diff stats.

## Commit Dialog

Click the **Commit** button in the header (or its keyboard shortcut) to open the commit dialog.

### Commit Dialog Features

1. **Changed files list** — Shows all modified, added, deleted, and renamed files with status icons.
2. **File selection** — Check/uncheck files to include in the commit. Only selected files are staged.
3. **Commit message** — Multi-line text area for your commit message.
4. **Amend option** — Toggle to amend the previous commit instead of creating a new one.
5. **Refresh** — Re-scan the working tree for changes.

### Commit Flow

1. Open the commit dialog.
2. Review changed files and select which to include.
3. Write a commit message.
4. Click **Commit**.
5. On success, a toast notification confirms the commit and diff stats refresh automatically.

Error states are shown inline with suggestions (e.g., "No staged changes", "Merge in progress").

## Diff Panel

Toggle the diff panel with `Cmd+D` / `Ctrl+D` or by clicking the diff stats in the header.

The diff panel appears on the right side of the chat area and shows all working tree changes:

- **Per-file sections** — Each changed file gets its own diff section.
- **Added lines** — Highlighted in green.
- **Removed lines** — Highlighted in red.
- **Unchanged context** — Collapsed with expand buttons.
- **Resizable** — Drag the left edge to resize (360px to 900px).

## Built-in Terminal

Toggle the terminal with `Cmd+J` / `Ctrl+J` or the terminal button in the header.

The terminal is a full terminal emulator:
- Runs in your project directory.
- Supports all standard terminal features (colors, cursor positioning, etc.).
- Persists across terminal toggles within the same session.

Use it for any git operations that aren't covered by the built-in UI, or for running tests, builds, and other commands directly.
