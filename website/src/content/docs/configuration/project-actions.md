---
title: "Project actions"
description: "Save project commands, manage running tasks and services, and prepare new worktrees."
order: 7
section: "Customize"
---

Project actions are commands you save for a project, such as tests, builds, or a development server. Run them from the **+ Action** menu in the session header. Their status, output, and controls appear under **Actions** in [Session Summary](/docs/using-openwaggle/session-summary), not in an ordinary terminal tab. Open it with **Open Session Summary** in the header.

Actions run in the selected session's workspace. For a worktree session, that means its worktree, not the original checkout. A command can also use a directory inside that workspace. Check the selected session before running anything that changes files. You can save a definition from an empty new-session draft, but launching it requires an existing session in that project.

## Save and run a command

1. Open **+ Action > Add action**, or **Settings > Project actions > Add action**. Settings has its own project picker; check that it names the right project.
2. Choose a suggestion under **Use a project script**, or enter a **Name** and **Command** yourself, such as `Run tests` and `pnpm test`.
3. Leave **Save to > Only on this device** selected for a private action. It belongs to this project, not every project on your machine.
4. For a finite command such as tests, keep the default **Task** run behavior. Use **More options** to change the working directory or other execution preferences.
5. Click **Save action**. Saving does not run the command.
6. Return to the session, open **+ Action**, and choose the action to run it.

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

A selected script stays linked to its task definition. Future launches use the task in the session's workspace and its package-relative directory. Editing the script in the repository therefore affects the next launch. If the task disappears on another branch, the saved action becomes unavailable instead of running a stale copy.

Editing the displayed **Command**, or choosing **Use as custom command**, replaces that link with command text you maintain yourself. **Refresh** rereads suggestions. Empty or failed discovery does not prevent you from entering a custom command. Other task formats, including `justfile` recipes, currently need a custom command.

## Tasks, services, and background work

Under **More options > Run behavior**, choose:

- **Task** for a command that finishes, such as tests or a build.
- **Service** for a command that keeps running, such as a dev server.

These are managed processes. You can view their output in the foreground or leave them running while you work elsewhere; there is no separate foreground/background switch.

By default, each action has one active run per workspace. Choosing an already-running action shows its existing output. It does not queue another run or interrupt it. Different actions and different workspaces can run independently.

Use **Stop** to end the selected run. **Restart** stops that run, waits for it to terminate, then starts a replacement using the current definition. After a run finishes, selecting the action again starts a new run. Tasks can opt into **Allow concurrent runs**; services remain single-instance.

Switching sessions or closing the output view does not stop a run. Managed runs can survive quitting the desktop app while the background session service remains alive. Reopening reconnects without launching another copy. If the process was lost, for example after a computer restart, OpenWaggle retains available output and offers **Restart** rather than silently relaunching it.

Services stop when the last session releases their workspace, including when that final session is archived. Releasing one session does not stop a service another session still uses. Service shutdown happens before workspace cleanup and removal.

## Open a dev-server preview

Save your server command and choose **More options > Run behavior > Service**. Under **Preview preferences**, enable **Open preview when ready** if you want the browser to open automatically.

OpenWaggle detects a URL from the run's output and waits until the server responds before opening it. Use **Preview URL override** if detection cannot find the right address. The URL belongs to that run and workspace, so a server using a different available port can have a different preview target.

You can also choose **Open preview** in the run's output view once it is ready. An HTTP response establishes that a server is listening, not that your application is healthy. Check output and the page itself if startup fails or the preview displays an error.

See [Browser preview](/docs/developer-workflow/browser-preview) for inspecting the page and sending feedback to the agent.

## Local and shared definitions

New actions default to **Only on this device**. OpenWaggle keeps them in local app storage, scoped to the selected project. Worktrees belonging to that project share its local definitions; unrelated projects do not.

Choose **In the project** to save an action in `.openwaggle/actions.json`. You can commit that file to share definitions with teammates. Saving it does not commit or publish anything. Keep credentials out of shared commands; sharing does not include approvals, prepared environment values, or run history.

Storage is a per-definition choice. Sharing a test action does not share your other actions, setup, or cleanup.

To customize a shared action privately, click **Edit**, select **Only on this device**, and save. OpenWaggle shows one effective entry marked **Locally overridden**, leaving the shared definition unchanged. Under **Storage and removal**, **Restore shared version** removes your override.

## Run setup for a new worktree

Setup is separate from an on-demand Project Action. Configure it in **Settings > Project actions > Workspace preparation**:

1. Select a **Preparation profile**, or use **Manage profiles > Add profile** to make one for a different workflow.
2. Under **Set up workspace**, click **Configure**.
3. Choose a project script or enter a command that finishes, such as the project's dependency-install command.
4. Check the working directory and storage choice, then click **Save setup**.

Saving a private setup definition enables that version on your machine. A shared definition needs explicit review and local enablement before it can run. Use **Review changes**, inspect the command and directory, then choose **Enable this version** or **Keep disabled**. Closing the review does not enable it.

When creating a new managed worktree, choose its **Preparation** profile if the project has more than one. Setup must finish successfully before the first agent turn starts. A failed or stopped attempt pauses that turn and offers **Retry setup** or **Continue anyway**. **Stop setup** stops the active attempt before releasing the workspace for other work.

Existing checkouts do not run setup merely because you open them or send a message. In Session Summary's **Workspace preparation** section, select a profile if needed, then choose **Run setup**.

Successful setup retains exported environment changes privately for that workspace. Later agent commands and action runs inherit them; already-running processes do not. Failed setup does not publish a partially prepared environment. Keep development servers as Service actions, not setup commands that never finish.

### Profile updates and cleanup

A worktree keeps a snapshot of the profile's setup and cleanup definitions. Editing the profile later does not silently change that worktree. Session Summary shows **A newer profile version is available** when applicable. **Adopt updated profile** replaces its snapshot, clears the prepared environment, and requires setup again.

The snapshot retains commands and task references, not copies of scripts they call. Changes inside those scripts still affect execution.

Configure optional cleanup under **Clean up workspace** in the same settings section. Cleanup runs before actual managed-worktree removal, while its files remain available, after the final session releases it. Setup and cleanup have independent storage choices.

Shared preparation commands show **Review required** when their execution definition changes. Review compares the previously reviewed version with the execution to enable. An unchanged, reviewed worktree snapshot can still run even if the project's current profile has changed.

If cleanup fails, OpenWaggle retains the worktree. In **Settings > Worktrees**, inspect **Cleanup output** and choose **Retry cleanup**. **Delete anyway** skips cleanup and may leave external resources behind. It is distinct from **Force remove**, which can also discard uncommitted changes or remove a locked worktree.

## Add a shortcut

Select the project you want to work in, then open **Settings > Shortcuts > Add binding**. In **Command**, choose your action under **Project Actions**, record a key combination, then click **Add binding**. Use Command, Control, Alt, or Shift with a key. Backspace or Delete clears the combination while recording.

Optional conditions limit when a binding applies. Unknown context names evaluate to false until supplied by the app. Review overlap warnings. Project Action bindings take precedence over built-in bindings; within each list, the last matching rule wins. Built-in shortcuts and Project Action bindings are managed in this same section.

## Edit and remove actions

In **Settings > Project actions**, click **Edit** beside an action and finish with **Save action**. Changes apply to its next launch, not to a process already running. Under **Storage and removal**, you can move the definition between local and project storage or choose **Remove definition**. Removing a definition does not undo commands already run; use the run's **Stop** control to end an active process.

If a failed or interrupted run offers **Fix with agent**, it adds a repair request to your message draft. Review and send it. The request asks the agent to propose a compatible command, not silently replace the saved definition or launch a replacement. Custom shell commands may need changes to work on another operating system.

Saved actions from older OpenWaggle versions migrate to native local definitions. Older worktree-setup selections become setup in the default preparation profile, while the original action remains available. New definitions no longer use the `actions` key in `.openwaggle/settings.json`.

Agents can discover actions, inspect runs and output, and request starts, restarts, or stops through the same managed execution system. Saving an action does not grant the agent permission to execute it. See [Approvals and permissions](/docs/configuration/approvals-permissions).
