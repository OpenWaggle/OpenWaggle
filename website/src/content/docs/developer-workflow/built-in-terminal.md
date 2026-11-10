---
title: "Built-in terminal"
description: "Run commands yourself, manage terminal tabs and split panes, and share command output with the agent."
order: 5
section: "Using OpenWaggle"
kind: "guide"
---

The built-in terminal runs your own shell inside OpenWaggle. Use it for commands you want to run yourself, such as starting a development server, running your project's tests to check the agent's work, or a Git command the diff panel does not offer. It is separate from the commands the agent runs through its tools.

Each session has its own terminal tabs. A new terminal starts in the session's working directory, which is the folder you opened or the session's worktree. Check which one before you run a command that changes files.

## Open the terminal

1. Open the session you want to work in.
2. Press `Cmd+J` on macOS or `Ctrl+J` on Windows and Linux, or click the terminal button in the header.
3. Wait for the shell prompt, then run your command.

Press `Cmd+J` or `Ctrl+J` again, or use the panel's close button, to hide the panel. Hiding it does not stop commands or development servers. Closing a pane or tab does.

## Ask the agent about output

Select the output you want to ask about, right-click, and choose **Add selection to chat**. The **Add to chat** button that appears beside a new selection does the same.

![The right pane of a split terminal with two passing-test lines selected and its menu open with Add selection to chat, Copy and Paste](/screenshots/terminal-add-to-chat.png)

The selection appears in the message box as a chip named after the terminal pane and the lines you selected. Add your question and send it.

![The message box with a Terminal chip for the selected lines, followed by a question about whether anything is missing before the merge](/screenshots/terminal-context-chip.png)

The chip carries the output, the terminal's name, its working directory, and which checkout it came from. The agent receives nothing until you send, and removing the chip drops it. OpenWaggle marks terminal output as untrusted context, so the agent reads it as information, not as instructions.

## Use tabs and split panes

A session's terminal can have several tabs, and each tab up to four panes, side by side or one below another.

![The terminal panel with two tabs, release checks (2) and Terminal 2, and the first tab split into two panes showing git status and node --test](/screenshots/terminal-split-panes.png)

The buttons at the right of the panel header open a new tab, split the active pane side by side, split it below, clear the pane, search it, move the tab to the side panel, and hide the panel. Each pane has its own close button.

- A tab with more than one pane shows the count after its name, as in **release checks (2)**. Double-click a tab, or focus it and press `F2`, to rename it.
- A new pane starts in the session's current working directory.
- While a command runs, the tab shows its name, such as `vim` or `bun run dev`.
- A process that listens on a port adds a `:port` chip to its pane. Click the chip to open its localhost address wherever **Open web links in** sends web links.
- **Open active terminal in side panel** moves the tab to the right side of the window. The bottom panel can stay open with your other tabs. **Return terminals to bottom** moves them back. Moving a tab keeps its shell running, with the same working directory, output and scrollback.

These shortcuts work while a terminal has focus:

| Action | macOS | Windows and Linux |
| --- | --- | --- |
| New terminal tab | `Cmd+N` | `Ctrl+N` |
| Split side by side | `Cmd+D` | `Ctrl+D` |
| Split below | `Cmd+Shift+D` | `Ctrl+Shift+D` |
| Close the active pane | `Cmd+W` | `Ctrl+W` |

Outside the terminal the same keys do other things: `Cmd+N` or `Ctrl+N` starts a new session, and `Cmd+D` or `Ctrl+D` opens the diff panel. Change any of them in **Settings > Shortcuts**. [Keyboard shortcuts](/docs/getting-started/keyboard-shortcuts) lists every default, with the setting names for these four, such as **Split terminal side by side**.

## Know which folder a terminal uses

- A terminal you open in an existing session starts in that session's working directory, so it sees the same checkout and branch as the agent.
- A terminal you open in a new session before its first message starts in the project folder. When you send the first message, the terminal moves into the new session with its shells, tabs, split panes and scrollback as they were. OpenWaggle holds new tabs and tab moves until the move finishes. If the session's browser tabs cannot move, terminals that already moved stay in the new session.
- If that first message creates a worktree, those earlier terminals stay in your original checkout and show **Original checkout**. New terminals start in the worktree. Choose **Restart in worktree** to stop an earlier shell and start it again in the worktree.
- Switching sessions switches the whole set of terminals. Two sessions never share one terminal panel.

Opening a terminal never creates a worktree. The first message does. See [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees).

## Search, clear and follow links

The search button in the panel header searches the focused pane, with match-case and previous and next buttons. The clear button, **Clear terminal**, empties the focused pane's scrollback, on screen and on disk, without restarting its shell.

OpenWaggle recognizes web addresses and file locations in the output, including links that wrap onto the next line and locations such as `src/app.ts:42:7`. `Cmd`-click on macOS, or `Ctrl`-click on Windows and Linux, to open one:

- A web address opens in your system browser. Set **Settings > General > Links > Open web links in** to **OpenWaggle** to open it in the [browser preview](/docs/developer-workflow/browser-preview) instead.
- A file inside the session's working directory opens in OpenWaggle's file preview at that line.
- A file outside it opens in your external editor at that line and column. OpenWaggle uses the editor you last picked in the file preview's editor menu, or else the first supported editor it finds. If it finds none, it shows an error rather than handing the file to whatever app your system would pick.

Right-click a selection for **Add selection to chat**, **Copy** and **Paste**.

## Close or restart a terminal

Closing a pane or tab stops its processes and deletes its history. A pane whose shell has exited, or is idle, closes at once. If OpenWaggle sees a running or background process, a listening port, or cannot tell whether the terminal is idle, it asks once before stopping the panes, and names the processes and ports it knows about. If stopping fails, the pane stays open.

**Restart** stops the shell and its processes, clears the terminal's history, and starts a new shell in the same working directory. **Restart in worktree** does the same for an earlier terminal and moves it into the session's worktree. Both ask first in the same way.

## What survives a reload or restart

- Hiding the panel or switching sessions keeps shells, development servers and other processes running.
- Reloading the app window reconnects to the same shells and shows their recent output once, without repeating it.
- Quitting OpenWaggle stops interactive terminals. On the next launch, each terminal shows its earlier output under **Previous terminal session**, cleaned up and capped, with a new shell below it.
- Each terminal keeps at most 5,000 lines and 10 MiB of scrollback, in memory and on disk.
- If a shell exits, its pane says so and offers **Restart**. If its working directory no longer exists, the pane shows an error instead of starting the shell somewhere else.
- Deleting a session stops its terminals and deletes their scrollback. Archiving a session stops its hidden terminal processes but keeps their layout and scrollback. Unarchiving starts new shells below the kept output. Removing a worktree stops the terminals running in it.

OpenWaggle restores each session's tabs, pane layout, tab names, active tab, panel height, and whether the panel was open.

Programs such as Pi's TUI ask the terminal for its colors, cursor position or identity. OpenWaggle never answers replayed output as if it were live. It removes those questions from restored output and drops any reply during the replay. So reopening a terminal never types a reply such as `4;0;rgb:0d0d/0f0f/1212` into your shell. What you type during the replay, and replies to questions a running program asks afterwards, still reach the shell. On a full restart, OpenWaggle also resets old input modes and full-screen program state before showing the earlier output.

## Type before the shell is ready

Anything you type before a supported shell shows its first prompt waits in a queue, in order, and OpenWaggle sends it once when the prompt appears. OpenWaggle knows when zsh, Bash, fish, PowerShell and `cmd` are ready. It does not guess from startup output. Moving the terminal, reloading the window, or restarting the shell keeps the queued text.

With a shell OpenWaggle does not know, the pane shows **Input waiting for shell readiness** and a **Send now** button, so you decide when to send it.

## Your shell and its environment

Each new terminal takes a fresh copy of the app's environment and starts your shell as an interactive login shell, when the shell supports that. It loads your usual startup files once. It keeps the variables your tools rely on, such as those for authentication agents, proxies, locale and your desktop session. It keeps your `PATH` order and adds common tool folders at the end, for apps started from the desktop rather than a terminal.

On macOS and Linux, OpenWaggle uses `SHELL`, then your account's login shell, then other shells installed on the system. On Windows it tries PowerShell 7, Windows PowerShell, your configured command processor, and `cmd`. It tells programs that the terminal supports 256 colors and true color.

It removes only OpenWaggle's own control variables and known Electron and Node.js code-injection variables. [Environment variables](/docs/reference/environment-variables#set-for-project-actions-and-terminals) lists what OpenWaggle sets and removes. The terminal runs commands with your full access, like any terminal you open yourself. Commands can read your other environment variables and credentials. See [Security and privacy](/docs/configuration/security-privacy).

OpenWaggle sets the terminal's font, colors and shortcuts from its own settings. It does not import profiles from Terminal.app, iTerm, Warp, Kitty or other terminal apps.

Terminal programs can turn on the Kitty keyboard protocol. OpenWaggle uses traditional key encoding until a program asks for it, then sends separate press, repeat and release events for richer shortcuts. When OpenWaggle uses a key for its own shortcut or for the clipboard, it also keeps the release, so the program never receives a release without its press.

## Resize and style the panel

Drag the panel's top edge to resize it, or double-click the edge to go back to the default height. With the edge focused, use `ArrowUp` and `ArrowDown`. Hold `Shift` for larger steps, or press `Home` or `End` for the smallest or largest height.

The terminal's font and size come from **Settings > Appearance**, which has a separate terminal font or can follow the code font. The cursor stops blinking when your system asks for reduced motion.

## Terminal commands and the agent's commands

The built-in terminal runs your commands. The agent's `bash` tool runs commands through Pi, the agent engine, with its own shell environment. A shell setting that works in your terminal may not apply to the agent's commands.

## Project actions and the terminal

[Project actions](/docs/configuration/project-actions) save commands you run often, such as a development server or your tests, and run them for you with their own output view. They do not type into your terminal or replace a command running there. **Open in terminal** on an action adds a read-only **action output** tab to the bottom panel that follows the run and its restarts, without starting a shell. Closing that tab never stops the action.

[Project actions](/docs/configuration/project-actions#how-runs-behave) explains how actions run, what output they keep, and how OpenWaggle saves the shared actions file.

## Recover after the app closes

Interactive terminals belong to the desktop app. Agent runs and project actions belong to the Session Host, which keeps working after you close the window. See [Check on work after closing the app](/docs/configuration/session-recovery#check-on-work-after-closing-the-app). Terminals and browser previews need the desktop app, and the command line does not open a hidden terminal in its place.

Quit the app normally when you can, so it can confirm that its terminals and previews have closed. If an earlier exit did not confirm this, the next launch shows a banner that starts with **Desktop tools are paused**. It sits below the header, or at the bottom of the window in Settings. You can still read sessions, but terminals, browser previews, archiving or deleting sessions, and removing worktrees stay blocked. Restarting the app does not clear the banner, and OpenWaggle does not kill old processes for you.

1. Check that nothing you started from the old window's terminals is still running, such as a development server, a file watcher or a background job.
2. Check that no Git command was cut off halfway.
3. Choose **Recover desktop tools** on the banner.

OpenWaggle then treats the old window as closed and connects the current one. Terminals, previews and archiving work again. Reopen any terminal that failed to start while tools were paused. If something from the old window is still running, OpenWaggle cannot stop it, and archiving or deleting its worktree can remove files it is using. The banner stays until you recover, because that is the only way to clear it.

If recovery fails, the banner says why. If it says the previous window has not timed out yet, its connection to the Session Host has not expired. Try again after a few seconds. If recovery keeps failing, quit OpenWaggle, run this command, and reopen the app:

```bash
openwaggle host stop --wait
```

If OpenWaggle cannot read your saved settings, or they are invalid, it stops before opening the workspace rather than replacing your terminal preferences and shortcuts with defaults. Choose **Retry** to read them again.
