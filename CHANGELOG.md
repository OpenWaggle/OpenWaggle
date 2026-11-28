# Changelog

What changed in each OpenWaggle desktop release, newest first. The website shows the same notes at [openwaggle.ai/changelog](https://openwaggle.ai/changelog/), and every release after 1.0.0-beta.43 publishes its entry as its GitHub Release notes. Builds before 1.0.0-beta.1 are listed only in [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases).

Each release PR writes its version's entry from the titles of the pull requests merged since the previous release: breaking changes, features, fixes and performance work. A Stable release's entry starts with the hand-written notes under `[Unreleased]`, which say what the release means for you; prereleases leave them for the next Stable release. Write those notes on `main` and leave the entries as the release PR wrote them.

## [Unreleased]

1.0.0 is OpenWaggle's first Stable release. These notes cover the whole 1.0.0 line, from 1.0.0-beta.1 through the release candidates, so if you are coming from a 0.x alpha, these are the changes that affect you.

### Compatibility from 1.0.0

From 1.0.0 on, version numbers follow semver for a defined set of covered surfaces. A change that breaks one of them ships only in a new major version, such as 2.0.0.

- Your data: sessions, settings, projects, credentials and the Session Host database. Every later 1.x release opens data written by an earlier 1.x release and migrates it forward. Downgrades are not supported.
- The `openwaggle hive`, `access`, `schedules`, `agents`, `mcp`, `recovery`, `status` and `host` commands, including their JSON and JSONL output, and the JSON output of `openwaggle update --check --json`. New fields can appear. Existing commands, flags and fields are not removed or renamed.
- The error kinds and exit codes of every `openwaggle` command. A refusal code keeps its kind. New kinds can appear.
- The `cursor`, `event` and `resync-required` records of `hive watch --jsonl`, `hive exports-watch --jsonl` and `run --jsonl`'s events. The bodies of `session-transport` and `session-waggle-transport` events follow Pi and are not covered.
- Session Control through the OpenWaggle MCP server's `openwaggle_hive` tool. An existing contract version keeps its meaning.
- The Agent-definition schema. A definition that is valid in 1.0.0 stays valid in 1.x.
- Scheduled tasks: the `openwaggle schedules` command, the `schedules:read` and `schedules:manage` capabilities, the `schedule_*` actions of the agent's `hive` tool, and Background start.
- Supported platforms: macOS 13.4 or later on Apple silicon and Intel, Windows 10 or later on x64, and Linux x64 with glibc 2.35 or later, such as Ubuntu 22.04, Debian 12 and Fedora 36. A minimum can rise in a minor version only once the OS vendor has ended support for that version, or when a supported Electron release requires it, and the release notes say so.

The extension host contract follows the `@openwaggle/extension-sdk` package's own versions. Pi extensions, skills and prompts follow Pi's compatibility. UI layout, wording, default settings and keyboard shortcuts can change in any release. The full rules are in [Release, versioning and CI/CD](https://github.com/OpenWaggle/OpenWaggle/blob/main/docs/release-and-versioning.md#v1-compatibility-promise).

### Renamed to hive before 1.0.0

If you script OpenWaggle or connect other agents to it, the coordination tool and its command line have new names. The old names are refused, with no alias.

- `openwaggle sessions …` and `openwaggle delegations …` are now `openwaggle hive <action>`. Each subcommand is flat and matches the agent's tool action, for example `hive follow-up`, `hive delegation-accept`, `hive delegations-list`, `hive queue-withdraw` and `hive request-respond`. `hive approval-respond` replaces `requests respond --approve`, and `hive authorization-set <id> inherit` replaces `authorization clear`. Exports use `hive export-create`, `hive export-cancel`, `hive exports-list`, `hive exports-read`, `hive exports-wait` and `hive exports-watch`.
- `openwaggle agents list` and `openwaggle agents search` are now `openwaggle hive agent-definitions-list` and `openwaggle hive agent-definitions-search`. The other `openwaggle agents` commands keep their names.
- The OpenWaggle MCP server's tool is now `openwaggle_hive`. An MCP client that calls `openwaggle_sessions` gets a tool-not-found error, so update its config. The tool's existing operations and their JSON are unchanged, and it adds `agent-definitions-list` and `agent-definitions-search`, which return the names and descriptions of the Agent definitions in a project the client is allowed to read.
- The agent's coordination tool is now `hive`. An Agent definition file that lists `sessions` under `tools` must list `hive` instead. Until it does, OpenWaggle reports `sessions` in it as an unknown reference. Sessions already created from such a definition are updated once, the first time you start the new version, so they keep the `hive` tool. Older conversations still show their `sessions` calls, as an unrecognized tool.
- Some outputs change. `openwaggle hive agent-definitions-list --json` and `openwaggle hive agent-definitions-search --json`, formerly `openwaggle agents list --json` and `search --json`, answer in the Hive response envelope, for example `{"schemaVersion":1,"type":"response","command":"hive agent-definitions-list","result":{"definitions":[…]}}`, instead of `{"schemaVersion":1,"result":[…]}`. Their errors use the Hive error envelope, `{"schemaVersion":1,"type":"error","error":{"kind":…,"message":…}}`, instead of `{"schemaVersion":1,"error":{"message":…}}`. The human-readable output of the delegation commands now uses the Hive CLI format, which titles a result after its operation or effect. The separate Delegations format is gone.
- `openwaggle schedules` and `openwaggle access` keep their names. The CLI guide moved to [Hive CLI](https://openwaggle.ai/docs/developer-workflow/hive-cli), and the old page redirects there.

### Ordinary flags instead of inline JSON before 1.0.0

No `openwaggle hive` or `openwaggle access` flag takes inline JSON any more. The old flags are refused with no alias, and the error names the flags that replaced them. The `openwaggle_hive` MCP tool and the agent's `hive` tool keep their structured parameters.

- `hive approval-respond <session> <run> <request>` takes `allow` or `deny`, and `--for once|session|project` to keep an approval. It replaces `--response-json`.
- `hive request-respond` replaces `--response-json` with one answer flag: `--choice <item>`, `--text <text>`, `--stdin` or `--input-file <path>`, `--confirm` or `--decline`, `--acknowledge`, `--value-file <path|->` for an extension's JSON value, or `--dismiss`. It reads the pending request first and refuses a flag that does not fit its kind, so its profile also needs `sessions:read`. A request that is no longer pending exits with `not_found` (5). For a request it does not list, the CLI asks the Session Host why, so a missing capability still exits with 4, and a retry with the same `--idempotency-key` replays the recorded answer for `--choice`, `--confirm`, `--decline` and `--value-file`. A refusal the CLI meets before it sends the command, such as a refused first read, goes to stderr, and the error envelope carries the Session Host's `code`. `--choice` refuses an item the request does not list as a usage error. An approval request gets the Session Host's answer, whether or not the caller can see it: `capability_denied` (4) without `sessions:respond`, or `interaction-mismatch` (6) with it.
- `hive delegation-claim` replaces `--claim-json` with `--read`, `--write`, `--read-tree`, `--write-tree`, `--read-resource` and `--write-resource`, each repeatable.
- `hive delegation-submit` and `hive delegation-verify` replace `--evidence-json` with `--evidence-command`, `--evidence-diff`, `--evidence-note`, `--evidence-artifact` and `--evidence-source`.
- `hive delegation-propose-amendment` and `hive delegation-amend` replace `--specification-json` with the `spawn` task flags plus `--objective`, `--depends-on <delegation-id>[:accepted]` and `--handoff`, and `--no-*` flags that empty a field. A field you leave out keeps its current value, and `delegation-amend --proposal <id>` applies the proposal as proposed, with no change flags. The changes apply to the revision the command names, so a retry with the same `--idempotency-key` replays. These commands read the delegation first, so their profile also needs `delegations:read`.
- `--request-json <path|->` on the message commands is now `--request-file <path|->`.
- `access profiles create` and `update` replace `--management-envelope-json` with `--manage-capability`, `--manage-all` or any of `--manage-project`, `--manage-session` and `--manage-hive`, and `--manage-export-root`, `--manage-attachment-root` and `--manage-authorization`. They apply only to a profile that gets `access:profiles`.
- `openwaggle run` prints these flags when it shows how to answer a question from another terminal.

### Machine output changes before 1.0.0

From 1.0 the `--json` and `--jsonl` output of the `hive`, `access`, `schedules`, `agents`, `mcp`, `recovery`, `status` and `host` commands, and of `update --check --json`, is covered by semver, and so are the error kinds, exit codes and watch records. A few parts of it change once now, so scripts written against the betas may need an update.

- The envelope's `command` is the whole command after `openwaggle`, for example `"command":"hive list"`, `"schedules list"`, `"host stop"` or `"access profiles list"`. Before, `hive` and `schedules` printed only the action, such as `"list"`, `host` printed `"host-stop"` and `"host-start"`, `host status` printed `"status"`, and `mcp registry search`, `get` and `add` printed `"mcp registry"`.
- `openwaggle schedules export` prints `{"schemaVersion":1,"type":"scheduled-tasks","tasks":[…]}` instead of a bare array, with or without `--json`. `schedules import` reads both, for all of 1.x, and refuses an export from a newer OpenWaggle with a message to update. `schedules import --json` always answers with an array, also for one task.
- A `hive watch --jsonl` or `hive exports-watch --jsonl` event record is now `{"kind":"event","cursor":…,"timestamp":…,"event":{"kind":…,"sessionId":…}}`, beside the `cursor` and `resync-required` records. Before, an event record had no `kind` and carried the event in `payload`, and a resync record named itself in `status` instead of `kind`. `openwaggle run --jsonl` prints its events as the same `event` records. Skip record kinds you do not know. The bodies of `session-transport` and `session-waggle-transport` events follow Pi and can change in any release, so read stable state with `hive read` or `hive status`.
- A watch that ends with a `resync-required` record exits with 9, the new `resync_required` error kind, instead of 1.
- The Session Host now names the kind of every refusal. Rejected outcomes and query errors carry `kind` beside `code`, the CLI exits with that kind's code, and every `openwaggle_hive` MCP tool error for a refusal, by the Session Host or by the server's own grants and scope, starts with the code and its kind, such as `target_scope_denied (authorization): …`. Some refusals exit differently than in the betas. For example, a missing delegation `reason` or an empty report is now a usage error (exit 2) instead of a conflict (6), and `parent_required` and `worker_required` are authorization errors (4). The full list is in [Hive CLI](https://openwaggle.ai/docs/developer-workflow/hive-cli#exit-codes-that-changed-before-10).
- A `type: "error"` envelope on stderr can carry an optional `code`, the Session Host's refusal code, when the failure was a Session Host refusal. That covers a refusal sent as an error, such as `capability_denied`, and one the CLI learns before it sends a command, such as a refused first read in `hive request-respond`. The field is covered by semver; its values are the Session Host's refusal codes, and new ones can appear.
- `openwaggle access profiles` answers `target_profile_revoked` for a change to a revoked profile and `target_profile_not_found` for a name that does not exist, instead of `profile_revoked` and `profile_not_found`. Their exit codes stay 6 and 5. `profile_revoked` and `profile_not_found` now mean only that your own profile was revoked or deleted.

### Updates and installation

- Settings > General > About & Updates has three update channels: Stable, Beta and Alpha. Stable is the default. Beta and Alpha also receive release candidates, and Stable never does. Changing channel never downgrades you.
- Restart to update installs the update on the first try and reopens OpenWaggle. If agent work is running in any session, it offers Restart when idle, Restart now and Cancel. Restart when idle is the default. It waits as long as the work takes and shows how many runs it is waiting for.
- Quitting the app never installs a downloaded update. An update installs only when you choose Restart to update, run `openwaggle update`, or run the install script.
- If an update did not install, OpenWaggle tells you the next time it opens. On macOS, when OpenWaggle was still running during the install, the message says so and names the usual causes: reopening the app too soon, or an `openwaggle` command such as `openwaggle mcp serve`.
- Updates download only the parts of the app that changed, after the first update following a manual install.
- On Intel Macs, image processing, the clipboard and browser cookie import work. The 1.0.0 betas shipped only the Apple silicon builds of those components.
- macOS builds are signed and notarized. The Dock icon now fits macOS's rounded-square shape instead of sitting on a grey tile.
- The install script now runs from a short address, `curl -fsSL https://openwaggle.ai/install | bash`, instead of its `raw.githubusercontent.com` address, which still works. Running it again keeps your update channel; set `OPENWAGGLE_CHANNEL` to switch. Versions up to 1.0.0-beta.37 can't report their channel, so a re-run over one of them saves the default channel instead; set `OPENWAGGLE_CHANNEL` that one time to stay on another. The script no longer installs a version older than the one you have, and stops with status 2 before it downloads anything, as `openwaggle update --version` does.
- The install script opens OpenWaggle when it finishes, unless you are on SSH, in CI, without a display, or pass `--no-launch`. Before it replaces an installed app, it asks about running agent work the same way Restart to update does.
- `openwaggle update` never installs under an open app. With the app open, it tells you to use Restart to update instead.
- `openwaggle update --check --json` prints the check as JSON, `{"schemaVersion":1,"type":"response","command":"update","result":{…}}`, with your saved update channel in `savedChannel`.
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
- A long paste that becomes a `Pasted Text` attachment shows once in the transcript, with its attachment. Before, it showed a second time, without the attachment.
- The command palette, Go to file and Search project contents take typing, the arrow keys and Enter as soon as they open. Closing one puts the focus back where it was.
- OpenWaggle shortens paths with `~` only for your own home folder. Before, it guessed the home folder from the path, so another user's folder could show as `~`.

### Notifications

[Desktop notifications](https://openwaggle.ai/docs/using-openwaggle/notifications) are new. OpenWaggle shows a notification and plays a sound when a session needs you or has finished, so you can work in another app while it runs.

- Four kinds notify. Needs you is for a session that waits for your approval or your answer, Workers included, and for a stuck Worker. The other three are Ready to read, Failed or interrupted, and Agent errors. They notify for a top-level session's run that you or a Scheduled task started, not for runs that another agent started. Failed or interrupted also covers a Scheduled task that OpenWaggle turned off because it needs your attention, unless it is a Heartbeat whose session you archived. A run you stopped never notifies.
- The Session Host sends them, so they keep coming with every window closed. Clicking one about a session opens OpenWaggle on that session.
- A session has at most one notification. Opening the session clears it, except Needs you, which stays until you answer the request or the Worker is no longer stuck. Archiving the session clears it too.
- Settings > Notifications turns each kind on or off, picks its sound, and sets what happens while OpenWaggle is focused. Show badge counts your notifications on the Dock icon, or shows a red dot on Windows. Show previews is off by default, so message text stays off your lock screen.
- Mute a session or a project from its menu in the sidebar. A muted session still notifies when it needs you.
- macOS asks whether OpenWaggle may show notifications the first time you start a run.

### Hives

- The new Hive panel on the right lists every Worker of a Hive at any depth, each under the session that created it. The tree hides archived Workers until you turn on Show archived. Turn on By next actor to group them into Needs you, a Waiting for group for each parent, Working and Closed, with archived Workers in a collapsed Archived group. The sidebar no longer lists Workers unless you pin them or search for them.
- When a Worker finishes, fails or asks for help after its parent has finished its turn, OpenWaggle starts a new run on the parent. A Queen that said it would report back when its Workers finish now gets a run to do it. The run starts with a Hive · Worker updates arrived line instead of a message from you. A parent whose last run was stopped or cut off waits until you send it something.
- OpenWaggle gives an agent that can create Workers the names and descriptions of its project's enabled Agent definitions, and asks it to use one when it fits a Worker's job. In the Hive panel, a Worker created from a definition shows an agent icon and a line such as `reviewer · High · <model>`, and the toolbar counts the sessions that run each definition.
- The `agent_definitions_list` and `agent_definitions_search` actions of the agent's `hive` tool read another project's definitions when the agent passes `projectPath`. Before, they ignored it and listed the caller's own project. Reading another project needs `sessions:create` and `sessions:discover`, so Workers can't.
- The agent's `hive` tool can search archived sessions with `includeArchived`, as `openwaggle hive search --include-archived` does. Archived sessions stay out of a search unless you ask for them.
- An agent in a top-level session you started from the app can now find, read, message, steer, interrupt, archive and start sessions in your other OpenWaggle projects. Workers, and runs started by a project-scoped CLI profile or MCP client, stay in their own project.
- Each session gets its own scratch folder, so agents in two sessions no longer overwrite each other's temporary files.
- Agents can look up and read the OpenWaggle documentation installed with the app.

### Scheduled tasks

[Scheduled tasks](https://openwaggle.ai/docs/using-openwaggle/scheduled-tasks) are new. A Heartbeat sends a prompt into an existing session on a schedule, and only while that session is idle. A Launch schedule starts a new session in a project each time, with its own model, thinking level and workspace.

- The Session Host runs them, so they keep firing with every window closed. Background start can start the Host when you log in.
- Find tasks in the Scheduled panel of the Right panel, in Settings > Scheduled tasks, and in the Session Summary. You can also ask an agent to set one up.
- Runs missed while the Host was stopped collapse into a single catch-up run.
- Every Heartbeat needs a way to finish: a "Stop when…" outcome, an end date, a run limit, or Runs indefinitely. Heartbeats you created during the Beta run indefinitely and say they have no end.
- A Heartbeat can run a cheap Wake check command before each firing. When it finds nothing to do, the firing is recorded as skipped and no agent turn or model call happens. A Heartbeat pauses itself when its Run says it is done, or after 3 idle runs in a row, and tells you once, with Resume. It can also use its own, cheaper model for its Runs.
- Manage tasks from a terminal with `openwaggle schedules`.
- A task an agent set up runs as the task's owner, which is you or the CLI access profile it belongs to, within what that agent could do when it created the task. A Launch schedule, or a Heartbeat in another session, keeps running if you archive or delete the agent's session. A Heartbeat in the agent's own session still pauses when you archive that session. Deleting that session deletes the Heartbeat. When the agent could do less than the owner, the task says it runs with limited access, until the owner changes its prompt, a Launch schedule's project, its model or another run setting, its stop condition or its Wake check.

### Right panel and workspace

- Every right-side panel, including extension panels, now opens from one Right panel with a panel rail. Toggle it with `Cmd+Option+B` (`Ctrl+Alt+B`). Reorder, pin and maximize panels. Each session remembers which panel it had open.
- The Project Actions panel can run, stop and restart actions, and open an action's output in the bottom drawer.
- Project Actions always show the open session's project. Before, a slow settings write could show another project's actions and save a new action there.
- View PR and View MR in the Session Summary now work, and open the request inside OpenWaggle. GitHub Enterprise and self-hosted GitLab are supported. Settings > Connections > Source control shows each host's provider and accounts, and agents get a `source_control` tool to check and fix that setup. Commit, Push and Create PR/MR from the Session Summary also work now.
- Worktree sessions keep working after a macOS restart. Before, a restart could stop every worktree session with "This worktree no longer matches its saved preparation".
- A worktree created just before OpenWaggle stopped is recovered on the next run.
- Removing a worktree from Settings > Worktrees no longer asks for Delete anyway when no cleanup was configured for it.
- Settings > Worktrees shows how much space worktrees take, in every project, and sorts them into Safe to remove, Needs a decision and In use. One button frees every safe worktree after a single confirmation. A worktree whose sessions aren't archived yet offers Archive & remove, which archives the sessions it names and then removes the worktree. If the worktree has uncommitted changes, it offers Archive Sessions instead, which archives them and keeps the worktree. OpenWaggle offers neither while a run, a terminal or an action uses the worktree.
- Automatic cleanup in Settings > Worktrees is off unless you turn on Remove worktrees of archived Sessions automatically. It then removes a worktree once every session in it has been archived for 7, 14, 30, 60 or 90 days. The default is 30. It never removes a worktree with uncommitted changes, commits that are not on a remote, a lock, a failed cleanup or a Git state it can't read, or one you made by hand. It keeps every branch, but it deletes the files Git ignores in the worktree, such as `.env` and `node_modules`.
- Archiving a session still keeps its worktree. If you restore a session whose worktree was removed, OpenWaggle offers to recreate it from the kept branch or to continue in the current checkout.

### Pi, MCP and providers

- OpenWaggle runs on Pi 1.6.0.
- Sessions you started with the `pi` command line in a project's folder are listed with that project's sessions and get titles the same way. Before you continue one that `pi` used last, OpenWaggle asks whether to continue in OpenWaggle or keep running in `pi`. Pi extension commands show in the slash menu.
- MCP servers run through Pi's built-in MCP support. OpenWaggle reads `~/.pi/agent/mcp.json`, `~/.openwaggle/mcp.json`, and the project's `.mcp.json`, `.pi/mcp.json` and `.openwaggle/mcp.json`. Existing OpenWaggle MCP settings are migrated once, with a backup.
- MCP now works as it does in `pi`. Adding a project trusts the MCP servers its files configure. The Global MCP switch, the per-server trust step and the MCP sandbox are gone, so local servers run with your user's permissions. In Ask for Approval mode every MCP tool call still asks first. In YOLO mode, the default, they run without asking.
- After the upgrade, if you had set up MCP in OpenWaggle, the projects it already knew keep their old state: servers that connected before stay on, and the others start off. Where MCP was off, every server starts off. If you never set up MCP in OpenWaggle, and in projects you add later, servers start as their files say, including Pi's files and a repository's `.mcp.json`.
- Each server has an exposure that decides how the agent reaches its tools. Settings offers Codemode, which is the default, and Hidden; a file can also say Deferred. A file's Direct runs as Codemode, so its tools' descriptions are no longer sent with every message. Tools that open an MCP App stay declared, and a session where codemode cannot run keeps Direct. The file is not changed, so the `pi` command still offers those tools directly. The `mcp` and `mcp_run` tools are gone. Agent definitions that list them keep working.
- Codemode is on in every session. The agent can write a short script that calls several tools in one step, and only what the script prints reaches the model. Turn it off, or change prompt cache warming, in Settings > General > Agent tools.
- Virtual models that Pi extensions register can be turned on in Available Models and picked like any other model. After a reply, the model picker shows which real model answered.
- A stuck MCP server process is replaced instead of failing every run.
- MCP Apps load and size themselves to their content, instead of showing an empty box.
- For providers that accept system messages mid-conversation, a new message no longer changes the start of the prompt, so they reuse their prompt cache. On one self-hosted model, the first reply after a new message took under 4 seconds instead of 34 to 48.
- A tool error that carries an image no longer breaks a Claude session for good.
- Settings > Connections > Available Models has search, filters and a provider list.
- If the provider list fails to load, Settings > Connections shows the error with a Retry button.
- Pi renamed the Azure provider from `azure-openai-responses` to `azure`. OpenWaggle moves your saved Azure model choices, and each session's model, to the new name, and copies your Azure credential to it. Model settings you added under the old name in Pi's `models.json` need renaming by hand.
- Amazon Bedrock picks up access keys that a login tool such as saml2aws rewrites in `~/.aws/credentials` while OpenWaggle runs, without a restart.

### Settings and usage

- The new Usage & Cost view shows token use and spending across the Pi sessions on this machine, broken down by day, model and project. Open it from the chart button beside Settings at the bottom of the sidebar. When a session file has no recorded cost for a reply, the view estimates it from the prices in Pi's model catalog.
- Settings > Archived items can search titles and transcripts, filter by project, date and type, and restore many items at once, with Undo.
- The Browser, Shortcuts and Appearance tabs in Settings use the full width of Settings, like the other tabs.

### Command line

- `openwaggle --help` lists every command, and a mistyped command suggests the right one instead of opening the app.
- `openwaggle run <prompt>` runs an agent and prints its reply in the terminal.
- `openwaggle status` shows whether the Session Host is running and what it is working on.
- `openwaggle host start` and `openwaggle host stop` start and stop the Session Host.
- `openwaggle <folder>` opens a folder as a project.
- `openwaggle mcp add` and `openwaggle mcp registry add` refuse `--exposure direct` with a usage error (exit code 2) and add nothing. Pass `--exposure codemode`, which is also the default.
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

- System requirements: macOS 13.4, Windows 10 (x64) or Linux x64 with glibc 2.35. On macOS 12 through 13.3 OpenWaggle still opens and updates, but semantic Session search and voice input don't work there. The 1.0.0 beta builds for Linux needed glibc 2.38 for the terminal and Project Actions; 1.0.0 runs them on Ubuntu 22.04 and Debian 12.
- Windows installers are not signed yet. Windows SmartScreen shows a warning the first time you install.
- Linux AppImages are not signed.
- 0.x macOS builds were unsigned, and macOS installs an update only when it is signed by the same team as the running app. If you are still on a 0.x build, install 1.0.0 by hand once, from GitHub Releases or with the install script. Updates after that install from the app.
- On Linux, opening Session links from other apps needs the desktop entry that the install script writes. If you installed before Session links shipped, run the install script again.

## [1.0.0-beta.47] - 2026-11-28

### Fixes

- **session-host:** stop the nightly canaries failing on Windows file locks, model downloads and macOS capacity ([#513](https://github.com/OpenWaggle/OpenWaggle/pull/513))

## [1.0.0-beta.46] - 2026-11-21

### Fixes

- **pi:** upgrade Pi runtime to 1.6.0 ([#508](https://github.com/OpenWaggle/OpenWaggle/pull/508))
- **linux:** pass the display backend switches through to the Session Host ([#500](https://github.com/OpenWaggle/OpenWaggle/pull/500))

## [1.0.0-beta.45] - 2026-11-19

### Features

- **providers:** restrict which providers a project's sessions may use ([#503](https://github.com/OpenWaggle/OpenWaggle/pull/503))

## [1.0.0-beta.44] - 2026-11-18

### Features

- **release:** write each release's changelog in its release PR and publish it at /changelog ([#488](https://github.com/OpenWaggle/OpenWaggle/pull/488))

### Fixes

- **composer:** rank exact skill matches first in the slash menu ([#502](https://github.com/OpenWaggle/OpenWaggle/pull/502))
- **attachments:** prepare a pasted image through the Session Host so it sends ([#495](https://github.com/OpenWaggle/OpenWaggle/pull/495))
- **sessions:** fork a Session worktree from the picked base ref ([#489](https://github.com/OpenWaggle/OpenWaggle/pull/489))
- **composer:** send skill references as Pi's /skill: command ([#487](https://github.com/OpenWaggle/OpenWaggle/pull/487))

## [1.0.0-beta.43] - 2026-11-17

### Features

- **attachments:** accept pasted screenshots and HEIC photos ([#481](https://github.com/OpenWaggle/OpenWaggle/pull/481))

### Fixes

- **sessions:** poll past a Host that disconnects mid-handshake instead of failing startup ([#485](https://github.com/OpenWaggle/OpenWaggle/pull/485))
- **hive:** wake the parent when a Worker answers new work sent after acceptance ([#483](https://github.com/OpenWaggle/OpenWaggle/pull/483))
- **deps:** write root overrides so npm and npx work again ([#478](https://github.com/OpenWaggle/OpenWaggle/pull/478))
- **license:** open the project to contributions with a GPL-3.0 app, MIT packages, CLA, trademark notice, and issue forms ([#471](https://github.com/OpenWaggle/OpenWaggle/pull/471))
- **qa:** wait for the Session Host's process to exit before removing a QA profile ([#472](https://github.com/OpenWaggle/OpenWaggle/pull/472))

## [1.0.0-beta.42] - 2026-11-16

### Breaking changes

- **extension-sdk:** publish types and result helpers with an Effect-free runtime ([#461](https://github.com/OpenWaggle/OpenWaggle/pull/461))

### Fixes

- **session-search:** wait for the model download in a required-fresh search ([#469](https://github.com/OpenWaggle/OpenWaggle/pull/469))
- **chat:** show a Run whose start a resync lost instead of a blank chat ([#457](https://github.com/OpenWaggle/OpenWaggle/pull/457))
- update MAX_INITIAL_RENDERER_GRAPH_BYTES to reflect accurate measurement ([5d8db4f](https://github.com/OpenWaggle/OpenWaggle/commit/5d8db4f0fafcb45b27586b0062c395e5976e178e))
- **hive:** start the Worker's Run when its parent requests a revision ([#456](https://github.com/OpenWaggle/OpenWaggle/pull/456))
- build and test with Bun and enforce the strictest type, lint and test checks ([#453](https://github.com/OpenWaggle/OpenWaggle/pull/453))
- **schedules:** give older and agent-created Sessions their schedule actions ([#455](https://github.com/OpenWaggle/OpenWaggle/pull/455))

### Performance

- ship a smaller Electron app that starts faster on Windows and uses less memory ([#450](https://github.com/OpenWaggle/OpenWaggle/pull/450))

## [1.0.0-beta.39] - 2026-11-13

### Fixes

- **windows:** start the Session Host under Avast and report its startup failures ([#447](https://github.com/OpenWaggle/OpenWaggle/pull/447))

## [1.0.0-beta.38] - 2026-11-10

### Breaking changes

- **cli:** settle the machine-output contract before 1.0.0 ([#432](https://github.com/OpenWaggle/OpenWaggle/pull/432))
- **cli:** replace inline-JSON flags with ordinary flags before 1.0.0 ([#429](https://github.com/OpenWaggle/OpenWaggle/pull/429))

### Features

- **hive:** show running Workers on parents' rows, header and rail ([#438](https://github.com/OpenWaggle/OpenWaggle/pull/438))

### Fixes

- **sessions:** count and limit agents' Runs in the person's Sessions ([#440](https://github.com/OpenWaggle/OpenWaggle/pull/440))
- **renderer:** settle void-fired Settings writes instead of floating their rejections ([#441](https://github.com/OpenWaggle/OpenWaggle/pull/441))
- **session-summary:** show the Session Summary by default ([#439](https://github.com/OpenWaggle/OpenWaggle/pull/439))
- **hive:** archive a Session that archives itself after its Run ends ([#431](https://github.com/OpenWaggle/OpenWaggle/pull/431))
- **schedules:** keep an agent-created Heartbeat's limits when the owner edits unrelated fields ([#435](https://github.com/OpenWaggle/OpenWaggle/pull/435))
- **cli:** address review findings on the ordinary CLI flags ([#433](https://github.com/OpenWaggle/OpenWaggle/pull/433))
- **installer:** refuse downgrades, keep the saved channel, and install from openwaggle.ai/install ([#427](https://github.com/OpenWaggle/OpenWaggle/pull/427))
- **release:** harden the RC and Stable release path before rc.1 ([#428](https://github.com/OpenWaggle/OpenWaggle/pull/428))
- **sessions:** never let busy Workers refuse the person's messages ([#434](https://github.com/OpenWaggle/OpenWaggle/pull/434))
- **chat:** roll elapsed timers over into hours ([#436](https://github.com/OpenWaggle/OpenWaggle/pull/436))
- **docs:** bring the Agent-definition schema and CLI docs up to date before rc.1 ([#426](https://github.com/OpenWaggle/OpenWaggle/pull/426))

## [1.0.0-beta.37] - 2026-11-08

### Fixes

- **release:** rebuild macOS when stapling loses its connection to Apple ([#423](https://github.com/OpenWaggle/OpenWaggle/pull/423))

## [1.0.0-beta.36] - 2026-11-08

### Features

- **notifications:** desktop notifications for Sessions that need you or are ready to read ([#417](https://github.com/OpenWaggle/OpenWaggle/pull/417))
- **hive:** offer Agent definitions to spawning agents and show them in the Hive panel ([#405](https://github.com/OpenWaggle/OpenWaggle/pull/405))

### Fixes

- **release:** build macOS on the supported macos-15 runner ([#421](https://github.com/OpenWaggle/OpenWaggle/pull/421))
- **hive:** apply review fixes to the idle-parent wake ([#418](https://github.com/OpenWaggle/OpenWaggle/pull/418))
- **hive:** wake an idle Queen when its Workers report, and report explicit submissions ([#416](https://github.com/OpenWaggle/OpenWaggle/pull/416))
- **command-palette:** keep keyboard focus in the search field when the palette opens ([#415](https://github.com/OpenWaggle/OpenWaggle/pull/415))
- **packages:** add the pending 0.2 package docs and catch missing release docs on pull requests ([#410](https://github.com/OpenWaggle/OpenWaggle/pull/410))
- estimate Usage & Cost from Pi's model catalog, and rewrite the user docs as plain-English guides and reference pages ([#408](https://github.com/OpenWaggle/OpenWaggle/pull/408))
- **sessions:** settle a failed targeted catalog refresh instead of floating its rejection ([#407](https://github.com/OpenWaggle/OpenWaggle/pull/407))
- show home-relative paths and illustrate the user docs with screenshots, diagrams, and schemas ([#406](https://github.com/OpenWaggle/OpenWaggle/pull/406))
- **settings:** let every Settings section fill the available width ([#403](https://github.com/OpenWaggle/OpenWaggle/pull/403))

## [1.0.0-beta.32] - 2026-11-03

### Features

- **error-reporting:** attribute renderer IPC rejections by API method in reports ([#401](https://github.com/OpenWaggle/OpenWaggle/pull/401))

## [1.0.0-beta.31] - 2026-11-02

### Fixes

- **schedules:** keep agent-created tasks running after their Session is deleted ([#400](https://github.com/OpenWaggle/OpenWaggle/pull/400))
- **bedrock:** pick up AWS keys rotated in the shared credentials file ([#398](https://github.com/OpenWaggle/OpenWaggle/pull/398))
- **hive:** let the hive tool search archived Sessions ([#397](https://github.com/OpenWaggle/OpenWaggle/pull/397))

## [1.0.0-beta.30] - 2026-10-29

### Features

- **settings:** redesign Settings > Worktrees and add Automatic worktree removal ([#396](https://github.com/OpenWaggle/OpenWaggle/pull/396))

### Fixes

- **session-search:** end the embedding child with SIGKILL so macOS stops reporting a crash ([#395](https://github.com/OpenWaggle/OpenWaggle/pull/395))
- **chat:** show a long pasted prompt once, with its attachment ([#393](https://github.com/OpenWaggle/OpenWaggle/pull/393))

## [1.0.0-beta.29] - 2026-10-28

### Performance

- start faster, use less memory, and send agents less context before v1 ([#391](https://github.com/OpenWaggle/OpenWaggle/pull/391))

## [1.0.0-beta.28] - 2026-10-27

### Breaking changes

- **scheduled-tasks:** gate Heartbeats with a Wake check, require a way to finish, auto-pause idle runs ([#389](https://github.com/OpenWaggle/OpenWaggle/pull/389))

## [1.0.0-beta.27] - 2026-10-27

### Fixes

- **terminal:** never answer terminal queries replayed on reattach ([#386](https://github.com/OpenWaggle/OpenWaggle/pull/386))

## [1.0.0-beta.26] - 2026-10-27

### Breaking changes

- **cli:** authenticate mcp serve profiles and make CLI errors typed and consistent ([#363](https://github.com/OpenWaggle/OpenWaggle/pull/363))
- **hive:** show a Queen all its Workers by default, fix Worker cleanup and tool ergonomics ([#364](https://github.com/OpenWaggle/OpenWaggle/pull/364))

### Fixes

- **website:** regenerate the screenshots from a capture script that runs against the current app ([#384](https://github.com/OpenWaggle/OpenWaggle/pull/384))
- **session-summary:** make the whole Hive row open the Hive panel ([#383](https://github.com/OpenWaggle/OpenWaggle/pull/383))
- **hive:** group Workers by who acts next and show Needs you only for what you must unblock ([#381](https://github.com/OpenWaggle/OpenWaggle/pull/381))
- **qa:** isolate hidden Electron QA and fail test files that leak temp dirs ([#368](https://github.com/OpenWaggle/OpenWaggle/pull/368))
- **session-host:** open OpenWaggle's SQLite files with one SQLite library ([#374](https://github.com/OpenWaggle/OpenWaggle/pull/374))
- **website:** serve a real 404 page, redirect /install.sh, derive the stage badge ([#367](https://github.com/OpenWaggle/OpenWaggle/pull/367))
- **hive:** resynchronize wait internally instead of returning resync_required ([#373](https://github.com/OpenWaggle/OpenWaggle/pull/373))
- **renderer:** open only readable resources, name Hive counts and states, and polish a11y and usage views ([#369](https://github.com/OpenWaggle/OpenWaggle/pull/369))
- **composer:** drag the whole queued message, with a placeholder and a drop line ([#379](https://github.com/OpenWaggle/OpenWaggle/pull/379))
- **scheduled-tasks:** show run trigger, UTC offset and jitter on every surface ([#365](https://github.com/OpenWaggle/OpenWaggle/pull/365))
- **session-host:** stop Run settlement stalls and report provider failures ([#366](https://github.com/OpenWaggle/OpenWaggle/pull/366))
- **git:** keep the Summary Git row for worktree branches and guard worktree removal ([#362](https://github.com/OpenWaggle/OpenWaggle/pull/362))
- **updater:** default installs to Beta, scope the macOS quit, keep --check read-only ([#360](https://github.com/OpenWaggle/OpenWaggle/pull/360))
- **release:** build Linux for glibc 2.35 and state the v1 platform minimums ([#361](https://github.com/OpenWaggle/OpenWaggle/pull/361))
- **renderer:** catch unhandled fire-and-forget IPC rejections in the GUI process ([#375](https://github.com/OpenWaggle/OpenWaggle/pull/375))

## [1.0.0-beta.25] - 2026-10-25

### Breaking changes

- **hive:** rename the sessions tool, CLI and MCP tool to hive ([#348](https://github.com/OpenWaggle/OpenWaggle/pull/348))

### Fixes

- **project-actions:** recover a worktree created just before the app stopped ([#343](https://github.com/OpenWaggle/OpenWaggle/pull/343))
- **project-actions:** remove worktrees without cleanup without asking for Delete anyway ([#342](https://github.com/OpenWaggle/OpenWaggle/pull/342))
- **session-host:** keep credential receipts valid across macOS reboots ([#341](https://github.com/OpenWaggle/OpenWaggle/pull/341))

## [1.0.0-beta.24] - 2026-10-24

### Fixes

- finish the Waggle package migration, retry failed provider catalogs, and pin dependencies ([#339](https://github.com/OpenWaggle/OpenWaggle/pull/339))

## [1.0.0-beta.23] - 2026-10-23

### Features

- **scheduled-tasks:** Heartbeats and Launch schedules run by the Session Host ([#335](https://github.com/OpenWaggle/OpenWaggle/pull/335))

### Fixes

- **sessions:** stop a full Host send budget from closing unrelated connections ([#338](https://github.com/OpenWaggle/OpenWaggle/pull/338))
- **pi:** upgrade Pi to 1.4.0 so error tool results with images stop breaking Claude sessions ([#336](https://github.com/OpenWaggle/OpenWaggle/pull/336))

## [1.0.0-beta.22] - 2026-10-22

### Features

- **sessions:** copy and open Session links ([#333](https://github.com/OpenWaggle/OpenWaggle/pull/333))

### Fixes

- **project-actions:** keep worktrees runnable when macOS renumbers the volume ([#329](https://github.com/OpenWaggle/OpenWaggle/pull/329))

## [1.0.0-beta.21] - 2026-10-19

### Features

- **settings:** search, filter, and bulk-restore archived items ([#325](https://github.com/OpenWaggle/OpenWaggle/pull/325))
- **chat:** fork from turn replies and fix desktop fork and clone ([#323](https://github.com/OpenWaggle/OpenWaggle/pull/323))

### Fixes

- **chat:** keep interaction cards inside the transcript column ([#328](https://github.com/OpenWaggle/OpenWaggle/pull/328))
- **sessions:** queue messages while a steered Follow-up waits for delivery ([#324](https://github.com/OpenWaggle/OpenWaggle/pull/324))
- **chat:** show extension status and offer Stop while a Run is finishing ([#326](https://github.com/OpenWaggle/OpenWaggle/pull/326))

## [1.0.0-beta.20] - 2026-10-16

### Features

- **pi:** title discovered Pi sessions and ask before continuing one pi used last ([#321](https://github.com/OpenWaggle/OpenWaggle/pull/321))

## [1.0.0-beta.19] - 2026-10-16

### Fixes

- **agents:** let agents discover and read the installed OpenWaggle docs ([#319](https://github.com/OpenWaggle/OpenWaggle/pull/319))

## [1.0.0-beta.18] - 2026-10-16

### Features

- **chat:** show a kind icon on every tool row and name the Worker each Hive row acts on ([#317](https://github.com/OpenWaggle/OpenWaggle/pull/317))

### Fixes

- **mcp-apps:** load MCP Apps from what their server declares and size them to their data ([#318](https://github.com/OpenWaggle/OpenWaggle/pull/318))
- **mcp:** point MCP guidance at Settings and replace stuck server processes ([#316](https://github.com/OpenWaggle/OpenWaggle/pull/316))
- **chat:** keep typed and pasted line breaks in user messages ([#314](https://github.com/OpenWaggle/OpenWaggle/pull/314))
- **usage:** give Usage & Cost a way back and a compact sidebar entry ([#313](https://github.com/OpenWaggle/OpenWaggle/pull/313))

## [1.0.0-beta.17] - 2026-10-15

### Features

- **usage:** add the Usage & Cost view for Pi session spending ([#312](https://github.com/OpenWaggle/OpenWaggle/pull/312))

### Fixes

- **stats:** keep the usage snapshot when npm or traffic reads fail ([#310](https://github.com/OpenWaggle/OpenWaggle/pull/310))

## [1.0.0-beta.16] - 2026-10-14

### Features

- **settings:** search and filter Available Models, and fix Sign in with ChatGPT ([#305](https://github.com/OpenWaggle/OpenWaggle/pull/305))

### Fixes

- **sessions:** decode nested tool calls in active Run snapshots ([#308](https://github.com/OpenWaggle/OpenWaggle/pull/308))
- **visualization:** render, retain selection state, and open session images ([#306](https://github.com/OpenWaggle/OpenWaggle/pull/306))

## [1.0.0-beta.15] - 2026-10-14

### Fixes

- **mcp:** stop notifying that MCP servers are still connecting ([#304](https://github.com/OpenWaggle/OpenWaggle/pull/304))

## [1.0.0-beta.14] - 2026-10-13

### Features

- **renderer:** move Hive Workers into a dedicated Hive panel (ADR 0051) ([#300](https://github.com/OpenWaggle/OpenWaggle/pull/300))
- **pi:** upgrade to Pi 1.2.0 and make OpenWaggle the GUI for the Pi ecosystem ([#303](https://github.com/OpenWaggle/OpenWaggle/pull/303))

### Fixes

- **sessions:** stop Session Host stalls that hid the Follow-up queue ([#301](https://github.com/OpenWaggle/OpenWaggle/pull/301))

## [1.0.0-beta.13] - 2026-10-13

### Fixes

- **sessions:** stop Session Host writes to dead clients from raising unhandled rejections ([#298](https://github.com/OpenWaggle/OpenWaggle/pull/298))

## [1.0.0-beta.12] - 2026-10-11

### Features

- **chat:** show the file diff when an edit row expands ([#294](https://github.com/OpenWaggle/OpenWaggle/pull/294))
- **source-control:** open PRs/MRs in the inspector and support enterprise GitHub and self-hosted GitLab ([#288](https://github.com/OpenWaggle/OpenWaggle/pull/288))

### Fixes

- **sidebar:** keep session rows from rendering behind section titles ([#295](https://github.com/OpenWaggle/OpenWaggle/pull/295))
- **resources:** capture and surface the evidence images agents embed ([#297](https://github.com/OpenWaggle/OpenWaggle/pull/297))
- **pi:** keep the leading prompt stable across Runs ([#296](https://github.com/OpenWaggle/OpenWaggle/pull/296))
- **actions:** keep Project Actions in the open Session's project ([#293](https://github.com/OpenWaggle/OpenWaggle/pull/293))
- **sessions:** stop losing replies and chat history, and keep Sessions live across Host stalls ([#282](https://github.com/OpenWaggle/OpenWaggle/pull/282))

## [1.0.0-beta.11] - 2026-10-08

### Fixes

- **desktop:** let users recover desktop tools after an unclean quit ([#289](https://github.com/OpenWaggle/OpenWaggle/pull/289))

## [1.0.0-beta.10] - 2026-10-07

### Fixes

- **updater:** install updates on the first restart and fit the macOS icon grid ([#286](https://github.com/OpenWaggle/OpenWaggle/pull/286))

## [1.0.0-beta.9] - 2026-10-05

### Features

- **stats:** add anonymous usage statistics and error reports ([#280](https://github.com/OpenWaggle/OpenWaggle/pull/280))

### Fixes

- **release:** retry transient hdiutil failures when building macOS DMGs ([#284](https://github.com/OpenWaggle/OpenWaggle/pull/284))

## [1.0.0-beta.7] - 2026-10-03

### Breaking changes

- **sessions:** show queued messages live, edit and reorder the queue, and make thinking level a Session setting ([#275](https://github.com/OpenWaggle/OpenWaggle/pull/275))

## [1.0.0-beta.6] - 2026-10-03

### Features

- **shell:** unified right panel with a panel rail ([#278](https://github.com/OpenWaggle/OpenWaggle/pull/278))
- **sessions:** generate short Session titles with a Title model ([#276](https://github.com/OpenWaggle/OpenWaggle/pull/276))

## [1.0.0-beta.4] - 2026-10-01

### Fixes

- **install:** match the installer's exact name in release checksums ([#272](https://github.com/OpenWaggle/OpenWaggle/pull/272))

## [1.0.0-beta.3] - 2026-10-01

### Fixes

- **sessions:** reach other projects and isolate Session scratch files ([#262](https://github.com/OpenWaggle/OpenWaggle/pull/262))

## [1.0.0-beta.2] - 2026-09-30

### Fixes

- **session-host:** stop Run replacement deadlocking on its own teardown ([#265](https://github.com/OpenWaggle/OpenWaggle/pull/265))
- **release:** rebuild macOS once when notarization loses Apple ([#269](https://github.com/OpenWaggle/OpenWaggle/pull/269))
- **release:** end quietly when the release PR is closed during validation ([#268](https://github.com/OpenWaggle/OpenWaggle/pull/268))
- **sessions:** save forks and keep branches on the conversation shown ([#267](https://github.com/OpenWaggle/OpenWaggle/pull/267))

## [1.0.0-beta.1] - 2026-09-30

### Features

- **release:** adopt the v1 release policy and update flow ([#264](https://github.com/OpenWaggle/OpenWaggle/pull/264))
- **cli:** add top-level help, run, status, and host commands ([#252](https://github.com/OpenWaggle/OpenWaggle/pull/252))

### Fixes

- **chat:** hold a sent message at the top until the reader scrolls ([#251](https://github.com/OpenWaggle/OpenWaggle/pull/251))
