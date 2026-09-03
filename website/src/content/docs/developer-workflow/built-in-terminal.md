---
title: "Built-in Terminal"
description: "The session-bound terminal: every terminal belongs to a session and its Working path."
order: 2
section: "Developer Workflow"
---

OpenWaggle includes a session-bound terminal for commands you run yourself. Every
terminal belongs to exactly one session and starts in that session's Working
path — the same tree the agent works in.

## Opening The Terminal

Use `Cmd+J` on macOS or `Ctrl+J` on Windows/Linux. You can also use the terminal
button in the header, or the New terminal / Split terminal commands in the
command palette.

## Session Binding

- A terminal opened while a session is active starts in that session's
  **Working path**: the Session worktree in worktree mode, the opened checkout
  in local mode. You can run commands against the exact branch the agent is
  working on.
- A terminal opened in the composer's draft state (before the first send)
  starts in the project directory. After the first send creates the Session
  worktree, **new** terminals bind to the worktree; terminals you opened in the
  draft keep running where they started.
- Switching sessions switches the terminal panel to that session's terminals.
  Terminals never mix between sessions.

## Multiple Terminals

- **New terminal** (`Cmd+Shift+J` / `Ctrl+Shift+J`) adds another terminal as a
  new tab.
- **Split terminal** (`Cmd+\` / `Ctrl+\`) adds another pane inside the current
  tab, side by side or stacked (up to four panes).
- Tabs can be renamed by double-clicking, and show the foreground process name
  (for example `vim` or `pnpm dev`) while a command is running.
- When a command inside a terminal starts listening on a TCP port, a small
  `:port` chip appears in the pane; click it to open the preview in your
  browser.

## Survival And Persistence

- Hiding the panel or switching sessions never kills a terminal. Dev servers
  and long-running processes keep running while the terminal is out of sight.
- Reloading the window — or quitting and reopening the app — restores each
  terminal's scrollback (up to 5,000 lines) when you view it again. If the
  shell process itself ended, it is restarted on demand, or you can use the
  **Restart** button in the pane.
- Deleting a session closes its terminals and deletes their scrollback.
  Archiving a session keeps its terminals running.

## Other Commands

- `Restart` respawns the shell in the same Working path with fresh scrollback.
- The search action (`⌕` in the panel header) searches the focused pane's
  output, with match-case toggle and previous/next navigation.
- The panel height is drag-resizable; double-click the top edge to reset it.

## Environment

The integrated terminal receives OpenWaggle's filtered terminal environment.

Pi's `bash` tool is different: it is executed by Pi during an agent run and
currently follows Pi SDK shell-environment behavior.
