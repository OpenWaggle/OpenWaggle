# Changelog

This file lists OpenWaggle's Stable releases, starting with 1.0.0. Earlier 0.x builds used a legacy release process and are still listed in [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases), along with every Beta and release candidate.

## 1.0.0

1.0.0 is OpenWaggle's first Stable release. These notes cover the whole 1.0.0 line, from 1.0.0-beta.1 through the release candidates, so if you are coming from a 0.x alpha, these are the changes that affect you.

### Compatibility from 1.0.0

From 1.0.0 on, version numbers follow semver for a defined set of covered surfaces. A change that breaks one of them ships only in a new major version, such as 2.0.0.

- Your data: sessions, settings, projects, credentials and the Session Host database. Every later 1.x release opens data written by an earlier 1.x release and migrates it forward. Downgrades are not supported.
- The `openwaggle hive` and `openwaggle access` commands, including their JSON and JSONL output. New fields can appear. Existing commands, flags and fields are not removed or renamed.
- Session Control through the OpenWaggle MCP server's `openwaggle_hive` tool. An existing contract version keeps its meaning.
- The Agent-definition schema. A definition that is valid in 1.0.0 stays valid in 1.x.
- Scheduled tasks: the `openwaggle schedules` command, the `schedules:read` and `schedules:manage` capabilities, the `schedule_*` actions of the agent's `hive` tool, and Background start.
- Supported platforms: macOS, Windows x64 and Linux x64.

The extension host contract follows the `@openwaggle/extension-sdk` package's own versions. Pi extensions, skills and prompts follow Pi's compatibility. UI layout, wording, default settings and keyboard shortcuts can change in any release. The full rules are in [Release, versioning and CI/CD](https://github.com/OpenWaggle/OpenWaggle/blob/main/docs/release-and-versioning.md#v1-compatibility-promise).

### Renamed to hive before 1.0.0

If you script OpenWaggle or connect other agents to it, the coordination tool and its command line have new names. The old names are refused, with no alias.

- `openwaggle sessions …` and `openwaggle delegations …` are now `openwaggle hive <action>`. Each subcommand is flat and matches the agent's tool action, for example `hive follow-up`, `hive delegation-accept`, `hive delegations-list`, `hive queue-withdraw` and `hive request-respond`. `hive approval-respond` replaces `requests respond --approve`, and `hive authorization-set <id> inherit` replaces `authorization clear`. Exports use `hive export-create`, `hive export-cancel`, `hive exports-list`, `hive exports-read`, `hive exports-wait` and `hive exports-watch`.
- `openwaggle agents list` and `openwaggle agents search` are now `openwaggle hive agent-definitions-list` and `openwaggle hive agent-definitions-search`. The other `openwaggle agents` commands keep their names.
- The OpenWaggle MCP server's tool is now `openwaggle_hive`. An MCP client that calls `openwaggle_sessions` gets a tool-not-found error, so update its config. The tool's operations and their JSON are unchanged.
- The agent's coordination tool is now `hive`. An Agent definition that lists `sessions` under `tools` must list `hive` instead. Until it does, OpenWaggle reports `sessions` in it as an unknown reference. Older conversations still show their `sessions` calls, as an unrecognized tool.
- `openwaggle schedules` and `openwaggle access` keep their names. The CLI guide moved to [Hive CLI](https://openwaggle.ai/docs/developer-workflow/hive-cli), and the old page redirects there.

### Updates and installation

- Settings > General > About & Updates has three update channels: Stable, Beta and Alpha. Stable is the default. Beta and Alpha also receive release candidates, and Stable never does. Changing channel never downgrades you.
- Restart to update installs the update on the first try and reopens OpenWaggle. If agent work is running in any session, it offers Restart when idle, Restart now and Cancel. Restart when idle is the default. It waits as long as the work takes and shows how many runs it is waiting for.
- Quitting the app never installs a downloaded update. An update installs only when you choose Restart to update, run `openwaggle update`, or run the install script.
- If an update did not install, OpenWaggle tells you the next time it opens. On macOS, when OpenWaggle was still running during the install, the message says so and names the usual causes: reopening the app too soon, or an `openwaggle` command such as `openwaggle mcp serve`.
- Updates download only the parts of the app that changed, after the first update following a manual install.
- macOS builds are signed and notarized. The Dock icon now fits macOS's rounded-square shape instead of sitting on a grey tile.
- The install script (`curl … | bash`) opens OpenWaggle when it finishes, unless you are on SSH, in CI, without a display, or pass `--no-launch`. Before it replaces an installed app, it asks about running agent work the same way Restart to update does.
- `openwaggle update` never installs under an open app. With the app open, it tells you to use Restart to update instead.
- The background Session Host now exits a few minutes after its last work ends, unless a Scheduled task is enabled. Before, it kept running.

### Sessions and chat

- New sessions get a short generated title a moment after the first message. Rename a session by double-clicking its title, pressing F2, or choosing Rename session. A title you set is never replaced. Regenerate title asks for a new one from the whole conversation. Choose which model writes titles, or turn them off, in Settings > Connections > Title model.
- Queued messages show in the transcript as soon as their own run starts. A steered message shows as Queued until the agent reads it, and goes back to the queue if the run stops first. You can edit, reorder, pause and resume the queue.
- The thinking level is now a session setting, like the model. The model and thinking pickers are locked while a run is active.
- Every session has a link, `openwaggle://sessions/<id>`. Copy it from the session menu, the command palette or `Cmd+Option+L` (`Ctrl+Alt+L`). Clicking one in a conversation, or opening it from another app, selects that session. Agents and the CLI accept a link anywhere they take a session ID.
- Your messages offer Edit from here and Fork from here. A finished reply offers Continue from here and Fork from this response. Fork and clone now save reliably, keep their visualizations, and are named after their source.
- Expanding an edit in the transcript shows the file's diff, with copy buttons and a link that opens the file at the first change.
- Each tool row starts with an icon for its kind, and a failed row turns red. Rows that coordinate Workers name the Worker they act on.
- After you send a message, it stays near the top of the view while the reply streams, instead of jumping down when the agent starts using tools.
- Line breaks you type or paste into a message are kept.
- While a run is finishing, the chat shows what an extension is still doing, and offers Stop if that takes more than a second.
- Screenshots and images that agents embed by file path now show in the chat and under Sources. Inline visualizations load reliably and keep the choices you made in them.

### Hives

- The new Hive panel on the right lists every Worker of a Hive at any depth, grouped into Needs you, Review, Active and Done. The sidebar no longer lists Workers unless you pin them or search for them.
- An agent in a top-level session you started from the app can now find, read, message, steer, interrupt, archive and start sessions in your other OpenWaggle projects. Workers, and runs started by a project-scoped CLI profile or MCP client, stay in their own project.
- Each session gets its own scratch folder, so agents in two sessions no longer overwrite each other's temporary files.
- Agents can look up and read the OpenWaggle documentation installed with the app.

### Scheduled tasks

[Scheduled tasks](https://openwaggle.ai/docs/using-openwaggle/scheduled-tasks) are new. A Heartbeat sends a prompt into an existing session on a schedule, and only while that session is idle. A Launch schedule starts a new session in a project each time, with its own model, thinking level and workspace.

- The Session Host runs them, so they keep firing with every window closed. Background start can start the Host when you log in.
- Find tasks in the Scheduled panel of the Right panel, in Settings > Scheduled tasks, and in the Session Summary. You can also ask an agent to set one up.
- Runs missed while the Host was stopped collapse into a single catch-up run.
- Manage tasks from a terminal with `openwaggle schedules`.

### Right panel and workspace

- Every right-side panel, including extension panels, now opens from one Right panel with a panel rail. Toggle it with `Cmd+Option+B` (`Ctrl+Alt+B`). Reorder, pin and maximize panels. Each session remembers which panel it had open.
- The Project Actions panel can run, stop and restart actions, and open an action's output in the bottom drawer.
- Project Actions always show the open session's project. Before, a slow settings write could show another project's actions and save a new action there.
- View PR and View MR in the Session Summary now work, and open the request inside OpenWaggle. GitHub Enterprise and self-hosted GitLab are supported. Settings > Connections > Source control shows each host's provider and accounts, and agents get a `source_control` tool to check and fix that setup. Commit, Push and Create PR/MR from the Session Summary also work now.
- Worktree sessions keep working after a macOS restart. Before, a restart could stop every worktree session with "This worktree no longer matches its saved preparation".
- A worktree created just before OpenWaggle stopped is recovered on the next run.
- Removing a worktree from Settings > Worktrees no longer asks for Delete anyway when no cleanup was configured for it.

### Pi, MCP and providers

- OpenWaggle runs on Pi 1.4.0.
- Sessions you started with the `pi` command line in a project's folder are listed with that project's sessions and get titles the same way. Before you continue one that `pi` used last, OpenWaggle asks whether to continue in OpenWaggle or keep running in `pi`. Pi extension commands show in the slash menu.
- MCP servers run through Pi's built-in MCP support. OpenWaggle reads `~/.pi/agent/mcp.json`, `~/.openwaggle/mcp.json`, and the project's `.mcp.json`, `.pi/mcp.json` and `.openwaggle/mcp.json`. Existing OpenWaggle MCP settings are migrated once, with a backup.
- MCP now works as it does in `pi`. Adding a project trusts the MCP servers its files configure. The Global MCP switch, the per-server trust step and the MCP sandbox are gone, so local servers run with your user's permissions. In Ask for Approval mode every MCP tool call still asks first. In YOLO mode, the default, they run without asking.
- After the upgrade, if you had set up MCP in OpenWaggle, the projects it already knew keep their old state: servers that connected before stay on, and the others start off. Where MCP was off, every server starts off. If you never set up MCP in OpenWaggle, and in projects you add later, servers start as their files say, including Pi's files and a repository's `.mcp.json`.
- Each server has an exposure that decides how the agent reaches its tools: Codemode, which is the default, Deferred, Direct or Hidden. The `mcp` and `mcp_run` tools are gone. Agent definitions that list them keep working.
- Codemode is on in every session. The agent can write a short script that calls several tools in one step, and only what the script prints reaches the model. Turn it off, or change prompt cache warming, in Settings > General > Agent tools.
- Virtual models that Pi extensions register can be turned on in Available Models and picked like any other model. After a reply, the model picker shows which real model answered.
- A stuck MCP server process is replaced instead of failing every run.
- MCP Apps load and size themselves to their content, instead of showing an empty box.
- For providers that accept system messages mid-conversation, a new message no longer changes the start of the prompt, so they reuse their prompt cache. On one self-hosted model, the first reply after a new message took under 4 seconds instead of 34 to 48.
- A tool error that carries an image no longer breaks a Claude session for good.
- Settings > Connections > Available Models has search, filters and a provider list.
- If the provider list fails to load, Settings > Connections shows the error with a Retry button.
- Pi renamed the Azure provider from `azure-openai-responses` to `azure`. OpenWaggle moves your saved Azure model choices, and each session's model, to the new name, and copies your Azure credential to it. Model settings you added under the old name in Pi's `models.json` need renaming by hand.

### Settings and usage

- The new Usage & Cost view shows token use and spending across the Pi sessions on this machine, broken down by day, model and project. Open it from the sidebar footer or the command palette.
- Settings > Archived items can search titles and transcripts, filter by project, date and type, and restore many items at once, with Undo.

### Command line

- `openwaggle --help` lists every command, and a mistyped command suggests the right one instead of opening the app.
- `openwaggle run <prompt>` runs an agent and prints its reply in the terminal.
- `openwaggle status` shows whether the Session Host is running and what it is working on.
- `openwaggle host start` and `openwaggle host stop` start and stop the Session Host.
- `openwaggle <folder>` opens a folder as a project.
- The CLI, agents and MCP clients can set a session's thinking level only when they create the session or start a run on an idle one. `hive follow-up`, `hive steer` and `hive replace` refuse `--thinking`, `--authorization` and `--yolo`, and `queue update-authorization` is gone.

### Reliability

- Sessions no longer fail with "This response couldn't be saved", lose their history when you quit during their first run, or hang until you restart OpenWaggle.
- After you switch branches in the sidebar, or retry with No summary, your next message goes to the branch on screen.
- Worker transcripts opened during a run show the whole run, and queued and steered messages show in the right order after a reconnect.
- Stop no longer fails with "Timed out waiting for the Local Session Host" when a session is replacing a Worker's run.
- Sending a message while a steered message waits for delivery no longer leaves the run stuck on Finishing.
- After an unclean quit, a banner offers Recover desktop tools. Before, terminals and browser previews stayed off until the database was edited by hand.
- Deleting a large session takes seconds instead of minutes, and sessions with very long transcripts can now be deleted. The "could not load durable Follow-ups" banner retries on its own.
- Opening a large session no longer closes the app's other connections to the Session Host.
- Retrying an `openwaggle access profiles create` or `rotate` command after restarting your Mac no longer fails with "The credential destination directory changed after installation".

### Privacy

Released builds send anonymous usage statistics and error reports, starting at the first launch. Neither carries an identifier for you, your install or your sessions. Usage statistics never contain prompts, model output, code or file paths. Error reports drop every error message, and before they leave your machine they replace your home folder, temporary folders and IDs in stack traces. That scrubbing can miss some personal data, such as a name in an unusual path. Turn them off in Settings > General, or with `DO_NOT_TRACK=1` or `PI_TELEMETRY=0`. [Usage statistics and error reports](https://openwaggle.ai/docs/configuration/usage-statistics) lists every field.

### Known limitations

- Windows installers are not signed yet. Windows SmartScreen shows a warning the first time you install.
- Linux AppImages are not signed.
- 0.x macOS builds were unsigned, and macOS installs an update only when it is signed by the same team as the running app. If you are still on a 0.x build, install 1.0.0 by hand once, from GitHub Releases or with the install script. Updates after that install from the app.
- On Linux, opening Session links from other apps needs the desktop entry that the install script writes. If you installed before Session links shipped, run the install script again.
