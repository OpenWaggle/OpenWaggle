---
title: "Built-in Terminal"
description: "Session-bound terminals with tabs, split panes, native shell startup, and durable scrollback."
order: 2
section: "Developer Workflow"
---

OpenWaggle's built-in terminal is a full PTY terminal for commands you run yourself. Each terminal
is scoped to the current draft or session. In an active session it starts in that session's
**Working path**: the Session worktree in New-worktree mode or the opened checkout in
Current-checkout mode.

## Opening The Terminal

Terminal shells belong to the desktop app, while agent sessions belong to the background
Session Host. Closing a client does not interrupt an agent run. A terminal-dependent project
action or browser operation does require an attached desktop; the CLI does not create an
invisible terminal as a fallback.

Use a normal app quit when possible so OpenWaggle can confirm that terminal processes and browser
previews have closed. If a previous desktop exits without confirming cleanup, a later launch
shows a **Desktop tools are paused** notice. Sessions and conversation retrieval remain available,
but terminal/browser admission and destructive operations that depend on their cleanup stay
blocked. Restarting the app does not erase that uncertainty or automatically kill old processes.

Use `Cmd+J` on macOS or `Ctrl+J` on Windows/Linux. The terminal button in the header and the global
command palette can also open it.

These shortcuts apply while focus is inside a terminal:

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| New terminal tab | `Cmd+N` | `Ctrl+N` |
| Split side by side | `Cmd+D` | `Ctrl+D` |
| Split below | `Cmd+Shift+D` | `Ctrl+Shift+D` |
| Close active pane | `Cmd+W` | `Ctrl+W` |

The same chords can have application meanings outside the terminal. For example, `Cmd/Ctrl+N`
creates a session and `Cmd/Ctrl+D` toggles the diff panel when terminal focus is elsewhere. You can
change the bindings in **Settings > Shortcuts**.

On a fresh settings store, OpenWaggle uses its built-in defaults. If the database cannot be read or
a saved current setting is invalid, OpenWaggle stops before opening the workspace. Terminal
preferences, shortcuts, and settings writes stay blocked instead of replacing your choices with
defaults. **Retry** reads the store again and resumes provider and authentication setup after it
succeeds.

## Session And Worktree Binding

- A terminal opened in an existing session starts in that session's Working path. It therefore runs
  against the same checkout and branch state as the agent.
- A terminal opened before the draft's first send starts in the opened project. The first send moves
  the terminal group into the new session without restarting its shells or losing its tabs,
  split-pane layout, or scrollback.
- If that send creates a Session worktree, inherited draft terminals stay in the original checkout
  and are labelled **Original checkout**. New terminals start in the Session worktree. Use
  **Restart in worktree** when you deliberately want to stop an inherited shell and relaunch it
  there.
- Switching sessions switches the entire terminal group. Tabs and panes from different sessions
  never share one panel.

Opening a terminal never creates a worktree. Worktree creation still happens on the first send, as
described in [Git Integration](/docs/developer-workflow/git-integration).

## Project actions

Project actions save commands that you run often, such as a development server, tests, lint, or a
build. Open **Settings > Project actions** to add or edit actions for the open project. Each action
can have an icon, multiple keyboard bindings, a preview URL, and an option to open that preview
after the command is accepted.

Each binding can run always or use a `when` condition with `!`, `&&`, `||`, and parentheses. The
available context names are `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, and
`modelPickerOpen`. Unknown names evaluate to false. When active bindings overlap, the last binding
in global configuration order wins. OpenWaggle warns about likely overlaps but preserves them, so
you can intentionally override a built-in shortcut or use one chord in different contexts.

The session header shows one primary action plus a menu for every saved action. The primary button
remembers the last action you ran in that project. Before any action has run, it uses the first
non-setup action, then the first action if the project contains only setup. Project actions also
appear in the command palette. Their bindings work throughout the workspace unless their `when`
condition limits them; the command palette temporarily suspends them while it is open.

An action runs in the current Session Working path. OpenWaggle reuses the focused terminal only
after it has confirmed that no child process is running. Otherwise it opens another terminal in the
same bottom or side-panel location, so a development server or editor is never overwritten by a
second command. The terminal receives these context variables in addition to the inferred user
shell environment:

- `OPENWAGGLE_PROJECT_ROOT` and the T3-compatible `T3CODE_PROJECT_ROOT`
- `OPENWAGGLE_WORKTREE_PATH` and `T3CODE_WORKTREE_PATH` when the session owns a worktree

Supported shells report an authenticated prompt boundary after the action finishes. A command that
starts and finishes between process samples is released by a fallback only after at least 1.5
seconds and two reliable idle samples. An unsupported shell has no authenticated prompt marker, so
that fallback cannot distinguish a long-running shell builtin that creates no child process. Wait
for such a builtin to finish, or use zsh, Bash, fish, PowerShell, or `cmd`, before running another
action in the same pane.

One action may be the **Setup action**. OpenWaggle starts it in a visible `setup-<action>` terminal
after it records a new Session worktree, before the agent turn begins. The same pending setup runs
after OpenWaggle recovers an interrupted worktree creation or you recreate a missing Session
worktree. OpenWaggle records a durable claim before terminal handoff. A terminal-open or
command-write failure reported before acceptance releases the claim, appears in the worktree launch
details, and remains retryable on the next send. Acceptance keeps a durable receipt, so that
worktree generation never starts setup again.

If the app stops after recording the claim, OpenWaggle cannot know whether the command reached the
shell. It will not replay that generation automatically because a setup command may have
non-idempotent side effects. The worktree launch details report this case. Inspect the visible
setup terminal, then run the action manually if it did not start. This is at-most-once crash
behaviour. OpenWaggle cannot make arbitrary shell execution exactly once because its database and
PTY process do not share a transaction.

OpenWaggle can discover compatible actions in a root `t3.json`, including JSON with comments. These
entries are checked-in action candidates, not executable configuration. Choose **Import** for each
command you trust; discovery alone never saves or runs it. Imports skip an exact duplicate command
or a case-insensitive duplicate name and preserve the one-Setup-action rule. `t3.json` does not
store T3 keyboard bindings, so importing or editing bindings never rewrites that file.

## Tabs And Split Panes

- **New terminal** adds a tab. Double-click its name, or focus it and press `F2`, to rename it.
- A tab can contain up to four panes, arranged side by side or stacked. The split actions add a new
  terminal in the session's current Working path.
- **Open active terminal in side panel** moves that tab into the right side of the workspace. The
  bottom drawer can remain open with other tabs; **Return terminals to bottom** moves the side-panel
  group back. Moving a tab preserves its running PTY, Working path, output, and scrollback.
- Process-aware tab labels show the foreground command, such as `vim` or `pnpm dev`, while work is
  running.
- A listening process can add a `:port` chip to its pane. Select the chip to route its localhost URL
  through your Web link destination.

## Search, Links, And Chat Context

The search button in the panel header searches the focused pane. It includes match-case and
previous/next controls. **Clear terminal** clears the focused pane's displayed and persisted
scrollback without restarting its shell.

OpenWaggle recognizes safe HTTP(S) URLs and file references, including wrapped links and file
locations such as `src/app.ts:42:7`. Use `Cmd`-click on macOS or `Ctrl`-click on Windows/Linux:

- URLs open in the system browser by default. Set **Settings > General > Links > Open web links in**
  to **OpenWaggle** to use the right-side Browser preview instead.
- Files inside the session's Working path open in OpenWaggle's file preview at the referenced line.
- Files outside that path open in your preferred installed external editor and keep their referenced
  line and column. OpenWaggle remembers the editor selected from the file-preview editor picker; if
  no preference exists, it chooses the first supported editor it finds. It reports an error instead
  of silently handing the file to an unrelated operating-system default application.

Right-click a terminal selection for **Add selection to chat**, **Copy**, and **Paste**. **Add
selection to chat** adds a removable context chip to the composer with the output, terminal label,
Working path, and checkout provenance. It remains a draft until you send the message, and
OpenWaggle marks the attached terminal output as untrusted context rather than instructions.

The Browser preview supports bounded tabs, profiles, responsive viewports, capture tools, agent
collaboration, and an explicit system-browser handoff. See [Browser Preview](/docs/developer-workflow/browser-preview)
for the complete workflow. Public hosts default to HTTPS when entered without a scheme; localhost
uses HTTP. Only HTTP(S) addresses without embedded credentials are accepted.

## Shell And Environment Fidelity

Each spawn takes a fresh snapshot of the app's environment and starts the user's shell as an
interactive login shell when that shell supports those modes. OpenWaggle loads the user's normal
startup files once and preserves exported variables used by local tools, authentication agents,
proxies, locales, and graphical sessions. It preserves the user's `PATH` order and adds common tool
locations as fallbacks for GUI-launched apps.

On macOS and Linux, shell resolution begins with `SHELL` and the operating-system account shell,
then falls back to installed platform shells. On Windows it tries PowerShell 7, Windows PowerShell,
the configured command processor, and `cmd`. OpenWaggle sets compatible terminal capability markers,
including 256-colour and true-colour support.

Only OpenWaggle control variables and known Electron/Node code-injection variables are removed.
This terminal is user command authority, not a restricted subprocess: commands can read the other
environment variables and credentials available to your account. See
[Security & Privacy](/docs/configuration/security-privacy).

OpenWaggle owns the terminal's font, colours, and shortcuts through its Appearance and shortcut
settings. It does not import the visual profiles of Terminal.app, iTerm, Warp, Kitty, or other
terminal emulators.

Modern terminal apps can opt into the Kitty keyboard protocol. OpenWaggle stays on traditional
terminal key encoding until an app requests that mode, then preserves distinct press, repeat, and
release events for richer TUI shortcuts. OpenWaggle-owned shortcuts and clipboard gestures consume
their matching release too, so the app never receives a release for a press that OpenWaggle used.

### Input During Shell Startup

Text entered before a supported shell reaches its first prompt is queued, kept in order, and sent
exactly once when the prompt is ready. OpenWaggle uses prompt integrations for zsh, Bash, fish,
PowerShell, and `cmd`; startup output alone is never treated as readiness. A viewport move, renderer
reload, or shell restart does not silently discard that queued batch.

For an unknown shell, OpenWaggle does not guess. The pane shows **Input waiting for shell
readiness** and a **Send now** action so you decide when queued input is safe to release.

## Survival And Restoration

- Hiding the panel or switching sessions detaches only the viewport. The shell, dev servers, and
  other processes keep running.
- Reloading the renderer reattaches to the same live PTY and restores its recent output without
  duplicating it.
- A full app restart cannot preserve operating-system processes. OpenWaggle restores sanitized,
  capped output as **Previous terminal session**, then starts a fresh shell below it. Historical
  terminal queries, input modes, and full-screen TUI state are neutralized before replay.
- Scrollback is capped per terminal at 5,000 lines and 10 MiB in both memory and local storage.
- If a shell exits, its pane reports the exit and offers **Restart**. If the recorded Working path no
  longer exists, OpenWaggle reports that error instead of silently starting somewhere else.
- Deleting a session stops its terminals and deletes their scrollback. Archiving stops hidden
  terminal processes but retains layout and scrollback; unarchiving starts clean shells below the
  retained output. Removing a Session worktree stops terminals that run inside it.

Tabs, pane layout, names, the active tab, panel height, and whether the panel is open are restored
per session.

## Closing And Restarting

`Cmd/Ctrl+J` and the panel's close button hide the panel; they do not stop shells. Closing a pane or
tab permanently stops its process tree and deletes that terminal's history.

A dead shell or a shell known to be idle closes immediately. If OpenWaggle detects an active or
background process, a listening port, or cannot confidently determine that the terminal is idle,
it asks once before stopping the affected panes. The confirmation names known processes and ports.
The pane stays visible if shutdown fails.

**Restart** stops the current process tree, clears the terminal's history, and launches a fresh
shell in the same Working path. **Restart in worktree** does the same while moving an inherited
draft terminal from the original checkout into its session's worktree. Both use the same
process-aware confirmation.

## Panel Size And Appearance

Drag the panel's top edge to resize it, or double-click the edge to restore the default height. With
the resize handle focused, use `ArrowUp` / `ArrowDown`; hold `Shift` for larger steps, or use `Home`
/ `End` for the minimum / maximum height.

Terminal typography follows **Settings > Appearance**, including the dedicated Terminal font and
size or the option to follow the Code font. Cursor animation follows the operating system's reduced
motion preference.

## Terminal Versus Pi Bash

The built-in terminal is for commands you run interactively. Pi's `bash` tool is run by Pi during an
agent turn and follows Pi SDK shell-environment behavior; it does not inherit the built-in
terminal's launch policy.
