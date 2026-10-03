---
title: "Project actions"
description: "Save project commands, manage their runs, and prepare new worktrees."
order: 7
section: "Customize"
---

Project actions are commands you save for a project, such as tests, builds, or a development server. Run them from **Project Actions** in the right panel: choose its icon on the panel rail along the right edge of the window. The icon shows a dot while one of the session's actions is running. Running and recent runs also appear under **Actions** in [Session Summary](/docs/using-openwaggle/session-summary).

Actions run in the selected session's workspace. For a worktree session, that means its worktree, not the original checkout. A command can also use a directory inside that workspace. Check the selected session before running anything that changes files. You can save a definition from an empty new-session draft, but launching it requires an existing session in that project.

## The Project Actions panel

The panel lists every saved action under **Run in this session’s workspace**. Each row shows the action's icon and name, the command or script it runs, its keyboard shortcut if it has one, and the state of its latest run, such as **Running**, **Ready**, **Completed**, or **Failed**.

- **Run** starts the action in the selected session's workspace. A row is disabled, with the reason beside it, when its script no longer exists in this workspace.
- While an action runs, **Stop** ends that run and **Restart** replaces it using the current definition. An action allowed to run several copies keeps **Run** and offers **Stop** for its latest run.
- **Show output** opens the latest run's output, status, and controls in the panel.
- The terminal icon, **Open in terminal**, shows the same output as a read-only tab in the bottom terminal drawer. See [Follow output in the terminal](#follow-output-in-the-terminal).
- **Add action** and **Continue new action** (or **Continue editing**) open the action panel described below. **Manage actions** opens **Settings > Project actions**.

The panel asks you to open a project when none is open, and to select a session in the project before running anything. Narrow panels move a row's controls below its name.

## Follow output in the terminal

**Open in terminal** in the Project Actions panel, or in a run's output view, opens a read-only tab in the bottom terminal drawer, labelled like **dev · action output** with a lock icon. It shows the run's retained and live output with the same rendering as your terminals, so colours, scrollback, search, links, and copying work as they do there. It attaches to the existing run; it does not start a shell or run the command again, and it does not accept typing.

- Each action has one such tab per session. Choosing **Open in terminal** again focuses it.
- When the action restarts, from the panel, a shortcut, or an agent, the tab follows the new run. Earlier output stays above a **restarted** divider.
- When a run ends, the tab keeps its final output and shows how it ended, such as `dev failed · exit 1`.
- Closing the tab closes only the view. The action keeps running; use **Stop** in Project Actions to end it. Stop and Restart are not in the terminal tab.
- Action output tabs come back with the terminal drawer after you restart OpenWaggle, and reconnect to the run's retained output.

## Save and run a command

1. Open **Add action** in the Project Actions panel, or **Settings > Project actions > Add action**. A panel opens on the right. It names the project it saves to; Settings has its own project picker, and the panel says so when that project differs from your current session's.
2. Answer **What should it run?** Choose **A script from this project** and pick one, or choose **A command I type myself** and type it, such as `pnpm test`.
3. Answer **What should it be called?** Picking a script suggests a readable name, such as **Run tests**. Each name must be different from the project's other actions, ignoring letter case.
4. Click **Save action**. Saving does not run the command. When you saved from Project Actions in a session, the confirmation offers **Run now** for that session. Saving from Settings instead highlights the new action in the list.

Everything under **Optional settings** already has a sensible default, shown in plain words next to each question. Click **Change** only when the default is wrong. The line above **Save action** summarises what will happen; click it to read the full sentence.

The panel docks beside your work like the other right sidebars. Drag its left edge to resize it; on narrow windows it opens over the app instead. Opening it replaces the sidebar you had open, and closing it brings that sidebar back.

You don't have to finish in one go. Closing the panel, or opening another sidebar, keeps what you have so far, even after a restart. The Project Actions panel then offers **Continue new action** or **Continue editing** the action. A project keeps one unfinished action at a time: starting another first asks whether to continue the one you had or discard it. **Cancel** discards it, and asks first if you had changed anything.

The output view shows the command, working directory, status, and exit result. Use **Copy output** or **Copy command** when you need to share a failure. Commands run with the access available to their process, not in a separate sandbox.

Commands receive `OPENWAGGLE_PROJECT_ROOT` for the project path and `OPENWAGGLE_WORKTREE_PATH` for the current workspace path. Prefer a workspace-relative working directory when the same action should work in multiple worktrees.

### Use a project script

OpenWaggle reads these task sources without running project code or installing dependencies:

| Project | Detected tasks |
|---------|----------------|
| JavaScript and TypeScript | `package.json` scripts at the root and in declared workspace packages, including `pnpm-workspace.yaml` packages. |
| Python with Hatch | Supported environment scripts in `pyproject.toml` or `hatch.toml`. |
| Rust | Project-local Cargo aliases in `.cargo/config.toml` or `.cargo/config`. |

Suggestions include the package or group and source file, so two packages' `test` tasks remain distinguishable. JavaScript tasks use the declared package manager or lockfile evidence; conflicting lockfiles produce a diagnostic rather than a guessed runner.

A selected script stays linked to its task definition. Future launches use the task in the session's workspace and its package-relative directory. Editing the script in the repository therefore affects the next launch. If the task disappears on another branch, the saved action becomes unavailable instead of running a stale copy. Editing such an action explains which script is missing and lets you keep the link or pick another script. If OpenWaggle saw the command that script ran on this computer, it also offers to use that command instead.

**Copy it as my own command instead** replaces that link with command text you maintain yourself, in the same folder. The script list rereads the project by itself; if reading fails, choose **Try again** or type a command. Other task formats, including `justfile` recipes, currently need a custom command.

## Actions that finish and actions that keep running

Under **Optional settings > Does it stop on its own?**, choose:

- **Yes, it finishes by itself** for a command such as tests or a build. Settings lists it as **Stops when done**.
- **No, it keeps running until I stop it** for a command such as a dev server or file watcher. Settings lists it as **Keeps running**.

Picking a script such as `dev` or `start` chooses the second answer for you.

These are managed processes. You can view their output in the foreground or leave them running while you work elsewhere; there is no separate foreground/background switch.

By default, each action has one active run per workspace. Choosing an already-running action shows its existing output. It does not queue another run or interrupt it. Different actions and different workspaces can run independently.

Use **Stop** to end the selected run. **Restart** stops that run, waits for it to terminate, then starts a replacement using the current definition. After a run finishes, selecting the action again starts a new run. For an action that finishes by itself, **If you click it while it is still running** can be changed to **Start another copy**; an action that keeps running always has one run at a time.

Switching sessions or closing the output view does not stop a run. Managed runs can survive quitting the desktop app while the background session service remains alive. Reopening reconnects without launching another copy. If the process was lost, for example after a computer restart, OpenWaggle retains available output and offers **Restart** rather than silently relaunching it.

Actions that keep running stop when the last session releases their workspace, including when that final session is archived. Releasing one session does not stop an action another session still uses. They stop before workspace cleanup and removal.

## Open a dev-server preview

Save your server command with **No, it keeps running until I stop it**. Then, under **Optional settings > Open it in the browser preview?**, choose **Yes, open the preview when the server is ready**. Picking a `dev` or `start` script turns this on for you.

OpenWaggle detects a URL from the run's output and waits until the server responds before opening it. Fill in the preview URL under the same setting only if detection opens the wrong address. The URL belongs to that run and workspace, so a server using a different available port can have a different preview target.

You can also choose **Open preview** in the run's output view once it is ready. An HTTP response establishes that a server is listening, not that your application is healthy. Check output and the page itself if startup fails or the preview displays an error.

See [Browser preview](/docs/developer-workflow/browser-preview) for inspecting the page and sending feedback to the agent.

## Local and shared definitions

New actions are saved for **Just me** by default, under **Optional settings > Who should have this action?**. OpenWaggle keeps them in local app storage, scoped to the selected project. Worktrees belonging to that project share its local definitions; unrelated projects do not.

Choose **Everyone working on this project** to save an action in `.openwaggle/actions.json`. You can commit that file to share definitions with teammates. Saving it does not commit or publish anything. Keep credentials out of shared commands; sharing does not include approvals, prepared environment values, or run history.

Storage is a per-definition choice. Sharing a test action does not share your other actions, setup, or cleanup.

When you edit a shared action, the question becomes **Who should get these changes?**. **Only me** keeps the shared version for everyone else and gives you a private version; Settings marks it **Locally overridden**. **Everyone on the project** updates the shared file. To move an action between private and shared without editing it, use **Storage and removal** in Settings.

## Run setup for a new worktree

Setup is separate from an on-demand Project Action. Configure it in **Settings > Project actions > Workspace preparation**:

1. Under **Set up new worktrees**, click **Configure**. The same panel opens.
2. Answer **What should it run?** with a project script or a command that finishes, such as the project's dependency-install command.
3. Check **Who should have this setup?** and the folder under **Optional settings**, then click **Save setup**.

Saving a setup turns it on for you, whether you keep it private or share it: you have just seen exactly what will run. The one exception is a teammate's change waiting for your review that you save without changing its command or folder; it stays off until you check it, and the saved message tells you so. A shared setup still needs each teammate's review before it runs on their computer, and a later change made by someone else needs your review. Settings shows **Check it before it runs** for those. **Check it** opens the panel with what changed in plain words; choose **Turn on this version** or **Keep it off**. Closing it leaves the setup off.

Profiles let different kinds of work use different setups. They stay out of sight until you need one: use **Add another setup profile** in the same section. Once a project has more than one, Settings shows a **Setup profile** picker and the panel names the profile it edits.

When creating a new managed worktree, choose its profile if the project has more than one. Setup must finish successfully before the first agent turn starts. A failed or stopped attempt pauses that turn and offers **Retry setup** or **Continue anyway**. **Stop setup** stops the active attempt before releasing the workspace for other work.

Existing checkouts do not run setup merely because you open them or send a message. In Session Summary's **Workspace preparation** section, select a profile if needed, then choose **Run setup**.

Successful setup retains exported environment changes privately for that workspace. Later agent commands and action runs inherit them; already-running processes do not. Failed setup does not publish a partially prepared environment. Keep development servers as actions that keep running, not setup commands that never finish.

### Profile updates and cleanup

A worktree keeps a snapshot of the profile's setup and cleanup definitions. Editing the profile later does not silently change that worktree. Session Summary shows **A newer profile version is available** when applicable. **Adopt updated profile** replaces its snapshot, clears the prepared environment, and requires setup again.

The snapshot retains commands and task references, not copies of scripts they call. Changes inside those scripts still affect execution.

Configure optional cleanup under **Clean up worktrees** in the same settings section. Cleanup runs before actual managed-worktree removal, while its files remain available, after the final session releases it. Setup and cleanup have independent storage choices.

Shared preparation commands show **Check it before it runs** when their execution definition changes. The review lists what changed since the version you last turned on. When a new worktree or a worktree removal is waiting on that review, the panel opens by itself. An unchanged, reviewed worktree snapshot can still run even if the project's current profile has changed.

If cleanup fails, OpenWaggle retains the worktree. In **Settings > Worktrees**, inspect **Cleanup output** and choose **Retry cleanup**. **Delete anyway** skips cleanup and may leave external resources behind. It is distinct from **Force remove**, which can also discard uncommitted changes or remove a locked worktree.

## Add a shortcut

In the action panel, **Optional settings > Keyboard shortcut** records one combination for the action. Use Command, Control, Alt, or Shift with a key. If the combination already does something else, the panel names it and asks whether to use it anyway.

For conditions or several bindings, choose **More shortcut options**, or open **Settings > Shortcuts > Add binding**. In **Command**, choose your action under **Project Actions**, record a key combination, then click **Add binding**. Backspace or Delete clears the combination while recording.

Optional conditions limit when a binding applies. Unknown context names evaluate to false until supplied by the app. Review overlap warnings. Project Action bindings take precedence over built-in bindings; within each list, the last matching rule wins. Built-in shortcuts and Project Action bindings are managed in this same section.

## Edit and remove actions

In **Settings > Project actions**, click **Edit** beside an action and finish with **Save changes**. Changes apply to its next launch, not to a process already running. If the saved action changed after you started editing, for example through `git pull`, the panel lists what changed and asks whether to **Keep my changes** or **Use the new version**. It never overwrites the other change silently.

**Remove this action**, at the bottom of the panel, explains what removal means before anything is removed. For a locally overridden action it is **Restore shared version** instead. Removing a definition does not undo commands already run; use the run's **Stop** control to end an active process.

Two actions with the same name keep working, for example when a teammate shares one called the same as yours. The Project Actions panel tells them apart with a grey hint, and Settings offers **Rename**.

If a failed or interrupted run offers **Fix with agent**, it adds a repair request to your message draft. Review and send it. The agent proposes a compatible command, and its reply shows **Review and save**. That opens the panel with the proposal and what it changes; nothing changes until you save. Custom shell commands may need changes to work on another operating system.

Saved actions from older OpenWaggle versions migrate to native local definitions. Older worktree-setup selections become setup in the default preparation profile, while the original action remains available. New definitions no longer use the `actions` key in `.openwaggle/settings.json`.

Agents can discover actions, inspect runs and output, and request starts, restarts, or stops through the same managed execution system. Saving an action does not grant the agent permission to execute it. See [Approvals and permissions](/docs/configuration/approvals-permissions).
