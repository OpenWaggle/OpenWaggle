---
title: "Built-in terminal"
description: "Run commands yourself, manage terminal tabs, and share command output with the agent."
order: 5
section: "Using OpenWaggle"
---

Use the built-in terminal to run commands yourself, such as starting a development server or checking the agent's work with your project's tests. It is separate from the commands the agent runs through its tools.

Each session has its own terminal tabs. New terminals start in the session's **Working path**, meaning its current checkout or its separate worktree. Check the path before running commands that change files.

## Opening the terminal

1. Open the session you want to work in.
2. Press `Cmd+J` on macOS or `Ctrl+J` on Windows and Linux, or click the terminal button in the header.
3. Wait for the shell prompt, then run your command.

To ask the agent about a result, select the output, right-click, and choose **Add selection to chat**. Add your question in the message box and send it. The agent does not receive selected output until you send.

Press the shortcut again to hide the panel. Hiding it does not stop commands or development servers. Close the pane or tab to stop its processes.

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

## Session and worktree binding

- A terminal opened in an existing session starts in that session's Working path. It therefore runs
  against the same checkout and branch state as the agent.
- A terminal opened before the draft's first send starts in the opened project. The first send moves
  the terminal group into the new session without restarting its shells or losing its tabs,
  split-pane layout, or scrollback.
- If that send creates a session worktree, inherited draft terminals stay in the original checkout
  and are labelled **Original checkout**. New terminals start in the session worktree. Use
  **Restart in worktree** when you deliberately want to stop an inherited shell and relaunch it
  there.
- Switching sessions switches the entire terminal group. Tabs and panes from different sessions
  never share one panel.

Opening a terminal never creates a worktree. Worktree creation still happens on the first send, as
described in [Git integration](/docs/developer-workflow/git-integration). For help choosing, see [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees).

## Project actions

Project actions save the commands you run often: development servers, tests, lint, and builds.
Open **+ Action** in the session header, then choose **Add action** to select a discovered project task or write a custom command.
Discovery reads package scripts, workspace packages, Hatch environment scripts, and Cargo aliases
from `.cargo/config.toml` or `.cargo/config`.
Saving a selected task keeps a reference to it. Each launch resolves the current task in that session's workspace, including its package directory.
A removed task stays visible as unavailable until you edit the action.

Actions are private to this project on your machine by default. Saving one creates no repository file.
Choose **In the project** under **Save to** to write the definition to `.openwaggle/actions.json`. This does not commit the file.
A personal override replaces the complete shared definition; **Restore shared version** removes it.
Settings shows where each definition comes from and offers explicit storage and removal controls.
Worktrees of the same project share private definitions, while unrelated projects remain separate.

If a shared save conflicts with an external edit, Settings retains both pending drafts and shows
the recovery directory under **Inspect pending drafts**. Each shared save keeps recovery files in
`.openwaggle/action-recovery/`, which ignores its own contents in Git. `previous.json` preserves the
file an external editor may still have open; `next.json` contains the prepared save. These files are
not deleted automatically, because an editor can finish writing after the save. Close external
editors, resolve any pending save, and compare those files with `.openwaggle/actions.json` before
manually removing old recovery directories.

Select an existing session in the project before running an action. You can save definitions from an empty draft, but running one requires a session.

The header keeps its **+ Action** button. Running and recent actions appear under **Actions** in
[Session Summary](/docs/using-openwaggle/session-summary). Select a run to open its output and
controls in the right sidebar. You can stop or restart it, copy output or its command, and open
its preview. **Fix with agent** adds a repair request to your message draft for review. It does
not send the request or edit the saved action automatically.

Actions have their own managed output view. They do not type commands into your interactive
terminal or replace a command already running there. Settings manages saved definitions and
preparation profiles; its running-process link takes you back to the session.

The Session Host owns action processes. Switching sessions or closing and reopening the GUI does
not launch a second process. By default, starting the same action again opens its active run.
Finite tasks can explicitly allow concurrent runs; services cannot. Restart validates the current
command before stopping the old execution. When the last active session releases a workspace,
OpenWaggle stops its services. Retained output is bounded, and trimmed output is marked.
If the owning Host itself is lost, the run becomes interrupted and requires an explicit restart.

Actions receive `OPENWAGGLE_PROJECT_ROOT` and `OPENWAGGLE_WORKTREE_PATH`, plus the private environment
exported by successful setup in that workspace. Variables unset by successful setup stay absent
from later actions, cleanup, and agent commands. Preview detection recognizes local URLs printed
by the run, or you can configure a URL. An opted-in preview opens once the endpoint responds.

Configure action shortcuts in **Settings > Shortcuts**. Conditional bindings can limit a shortcut
to contexts such as terminal or preview focus. Check conflict warnings if two actions share a binding.

For the full configuration workflow, see [Project actions](/docs/configuration/project-actions).

### Workspace preparation

**Settings > Project actions > Workspace preparation** manages separate setup and cleanup commands.
A project starts with a Default profile and can add named profiles. When several exist, choose one
in the composer before creating a worktree. Each workspace retains a snapshot of that profile.
Later edits show **A newer profile version is available**; adopting it is explicit and clears the
previous prepared environment.

If a private setup or cleanup and a shared definition occupy the same profile and phase, the private
definition wins. Restore shared version removes it. Explicitly storing the private version in the
project replaces that shared phase with the version you selected.

Setup must finish successfully before the first agent turn in a new managed worktree. Failure keeps
its output and offers **Retry setup** or **Continue anyway** in Session Summary. Existing checkouts
run setup only when you choose **Run setup**. Successful shell exports stay private to that workspace
and are inherited by subsequent actions and agent shell commands.
**Stop setup** stops a stuck attempt and then offers Retry or Continue anyway. Recreating a missing
worktree keeps its profile snapshot but clears old completion and environment values, so setup runs
again for the replacement checkout.

Shared setup and cleanup require local review and enablement. Execution changes require another
review. The review dialog shows the previous and current invocation and offers **Enable this version** or
**Keep disabled**. A previously reviewed workspace snapshot does not silently adopt upstream edits.

Cleanup runs before actual worktree removal, after its last binding is released and action processes
have stopped. Failure retains the checkout. In **Settings > Worktrees**, choose **Retry cleanup** or
explicitly confirm **Delete anyway**. That override can leave external resources behind.

Existing saved actions are converted to private native definitions with their identities, commands,
shortcuts, and preview preferences preserved. Legacy setup becomes a separate preparation definition
requiring review. Conversion retains a local recovery copy and runs nothing.

## Tabs and split panes

- **New terminal** adds a tab. Double-click its name, or focus it and press `F2`, to rename it.
- A tab can contain up to four panes, arranged side by side or stacked. The split actions add a new
  terminal in the session's current Working path.
- **Open active terminal in side panel** moves that tab into the right side of the workspace. The
  bottom drawer can remain open with other tabs; **Return terminals to bottom** moves the side-panel
  group back. Moving a tab keeps its shell running and preserves its Working path, output, and scrollback.
- Process-aware tab labels show the foreground command, such as `vim` or `pnpm dev`, while work is
  running.
- A listening process can add a `:port` chip to its pane. Select the chip to route its localhost URL
  through your Web link destination.

## Search, links, and chat context

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
Working path, and which checkout it came from. It remains a draft until you send the message, and
OpenWaggle marks the attached terminal output as untrusted context rather than instructions.

You can inspect a web app, test screen sizes, or send annotated screenshots to the agent without leaving OpenWaggle. See [Browser preview](/docs/developer-workflow/browser-preview) for the workflow. Public hosts default to HTTPS when entered without a scheme; localhost
uses HTTP. Only HTTP(S) addresses without embedded credentials are accepted.

## Shell and environment fidelity

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

### Input during shell startup

Text entered before a supported shell reaches its first prompt is queued, kept in order, and sent
exactly once when the prompt is ready. OpenWaggle uses prompt integrations for zsh, Bash, fish,
PowerShell, and `cmd`; startup output alone is never treated as readiness. Moving the terminal, reloading the app interface, or restarting the shell does not silently discard the queued input.

For an unknown shell, OpenWaggle does not guess. The pane shows **Input waiting for shell
readiness** and a **Send now** action so you decide when queued input is safe to release.

## Survival and restoration

- Hiding the panel or switching sessions keeps shells, development servers, and other processes running.
- Reloading the app interface reconnects to the same running shell and restores recent output without duplicating it.
- A full app restart does not preserve interactive terminal processes. OpenWaggle restores sanitized,
  capped output as **Previous terminal session**, then starts a fresh shell below it. Historical
  terminal queries, input modes, and full-screen TUI state are neutralized before replay.
- Scrollback is capped per terminal at 5,000 lines and 10 MiB in both memory and local storage.
- If a shell exits, its pane reports the exit and offers **Restart**. If the recorded Working path no
  longer exists, OpenWaggle reports that error instead of silently starting somewhere else.
- Deleting a session stops its terminals and deletes their scrollback. Archiving stops hidden
  terminal processes but retains layout and scrollback; unarchiving starts clean shells below the
  retained output. Removing a session worktree stops terminals that run inside it.

Tabs, pane layout, names, the active tab, panel height, and whether the panel is open are restored
per session.

## Closing and restarting

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

## Panel size and appearance

Drag the panel's top edge to resize it, or double-click the edge to restore the default height. With
the resize handle focused, use `ArrowUp` / `ArrowDown`; hold `Shift` for larger steps, or use `Home`
/ `End` for the minimum / maximum height.

Terminal typography follows **Settings > Appearance**, including the dedicated Terminal font and
size or the option to follow the Code font. Cursor animation follows the operating system's reduced
motion preference.

## Terminal versus Pi bash

The built-in terminal runs your interactive commands. The agent's `bash` tool runs commands through Pi, the agent engine, and uses its own shell environment. Do not assume a shell customization in the terminal also applies to the agent's commands.

### App shutdown and recovery

Interactive terminal shells belong to the desktop app. Agent runs and managed Project actions belong to a separate background process, the Session Host. Closing the desktop leaves those runs alive while their workspace remains in use. Interactive terminals and browser operations still need the desktop connected; the CLI does not create an invisible terminal as a fallback.

Quit the app normally when possible so it can confirm that terminal processes and previews have closed. If a previous exit did not confirm cleanup, a later launch shows **Desktop tools are paused**. You can still view sessions, but new terminal/browser operations and destructive actions requiring cleanup stay blocked. Restarting does not clear this uncertainty or automatically kill old processes.

If saved settings cannot be read or are invalid, OpenWaggle stops before opening the workspace rather than replacing your terminal preferences and shortcuts with defaults. Choose **Retry** to read the same settings store again.
