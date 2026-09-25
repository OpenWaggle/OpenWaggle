---
title: "App settings"
description: "Find settings for models, permissions, appearance, browser previews, and project tools."
order: 8
section: "Customize"
---

Click the gear icon in the sidebar to open Settings. For a first setup, connect a model in **Connections**, choose an access mode in **Permissions**, and leave the other settings alone until you need them.

Most settings apply across the app. Sections with a project picker let you inspect a particular project without switching your current conversation. Check the selected project before changing an override.

## Active sections

| Section | Use it to |
|---------|-----------|
| General | Choose where links open, adjust automatic context compaction, and check for updates. |
| Browser | Manage browser profiles, agent browser access, cookie imports, and preview defaults. |
| Project actions | Save project tasks and services, choose local or shared storage, and configure workspace setup and cleanup. |
| Shortcuts | View and customize keyboard bindings. |
| Appearance | Choose syntax colors, terminal colors, fonts, diff layout, and reduced motion. |
| Waggle Mode | Configure multi-agent collaboration and presets. |
| Extensions | Manage OpenWaggle and Pi extensions. |
| Skills | Browse skills for a selected project. |
| Agents | Configure agent-created Workers and browse Markdown agent definitions. |
| Permissions | Set default and project access modes, and revoke saved approvals. |
| MCP | Connect external tools and services, review their access, and diagnose connection problems. |
| Worktrees | Choose the default checkout mode and manage Git worktrees. |
| Archived items | Restore archived sessions or conversation branches, and permanently delete archived sessions. |
| Connections | Connect provider accounts and choose which models appear beside the message box. |

## Agents and permissions

Start with **Settings > Permissions > Default access mode > Ask for Approval** if you want to review protected actions. This is not a read-only mode. See [Approvals and permissions](/docs/configuration/approvals-permissions) before granting wider access.

**Selected project** sets a project-specific mode. **Use default** removes that override. **Saved approvals** lists permissions you kept for the selected project; **Revoke** stops their future use but does not undo completed work.

In **Settings > Agents**, **Agent-created Workers** allows agents to create other sessions to share a task. A Worker is another conversation with its own work and tool activity. See [Hives and sessions](/docs/using-openwaggle/hives-and-sessions) before enabling parallel work.

- **Workers per parent** defaults to `4` active direct Worker runs per parent session.
- **Active agent runs** defaults to `16` across independent sessions and Hives.

A run is one period of agent work, not a saved conversation. Saved sessions, queued follow-ups, searches, waits, and exports do not consume these run slots. Reaching a limit rejects a new run with a retryable error rather than hiding it in a queue. You can raise the limits, but more simultaneous runs may strain your machine or provider quota.

Project configuration can override the project-specific controls. If an older version saved project overrides, **Saved project overrides** lets you inspect and clear them. Clearing a saved value does not remove an override in a project file.

Below the controls, select a project to read its agent definitions or enable and disable them for new sessions. There are no bundled roles or built-in definition editor. Edit the Markdown files in your project; see [Agent definitions](/docs/extending/agent-definitions). **Skills** has its own project picker and browser.

## General

**Open web links in** chooses whether links open in OpenWaggle or your external browser.

**Context compaction** controls when OpenWaggle reduces the older context sent to a model so a long conversation can continue. **Automatic compaction threshold** defaults to **80%** of the model's context capacity. It applies across models, projects, and sessions. The model's capabilities determine whether this uses native compaction or a portable summary; there is no provider-specific switch.

**About & Updates** shows your installed version and update channel. Stable is the default. Beta also accepts Stable releases; Alpha accepts Alpha, Beta, and Stable releases. Entering Alpha requires confirmation. Changing the channel saves it and immediately checks for an eligible update, but never authorizes a downgrade.

Use **Check now** to check again. A downloaded update installs only when you choose **Restart to update**. OpenWaggle rechecks that it is still eligible for your channel before restarting; ordinary app exit does not install it. The app and `openwaggle update` share the channel setting.

### Command-line availability

The CLI ships with the app. Packaged macOS and Linux launches install or refresh `~/.local/bin/openwaggle`; the Windows installer provides the command. Ensure the install directory is on your shell's `PATH`.

General shows a read-only warning if the command is missing, outdated, blocked by another file, or not on `PATH`. There are no CLI installation controls here. OpenWaggle does not replace an unrelated file at the command path; resolve that conflict yourself. An exact legacy macOS link to the app still works, but rerun the installer if you move the app. From source, use `pnpm cli:dev -- <command>`.

## Appearance

Use **Settings > Appearance** to adjust readability without changing your code:

- Choose syntax themes and accessibility profiles using the preview.
- Adjust terminal colors and typography.
- Set **Diff layout** to **Unified** or **Side by side**.
- Enable **Wrap long lines** to avoid horizontal scrolling in diffs.
- Enable **Reduce motion** to minimize animation instead of following the operating system's preference.

Diff layout and line wrapping are shared with the diff panel's own controls. These appearance choices apply across projects, not through a project settings file.

## Browser

In **Settings > Browser**, use **Let agents open and drive the preview browser** to control agent access. Turning this off withholds browser tools from the agent. It is separate from where links open.

**New preview tabs use** selects a browser profile. Persistent profiles keep cookies and site data; Incognito uses memory only. Review what an imported login allows before giving an agent access to that profile.

Preview defaults include **Viewport**, **Zoom**, **Appearance**, **Recording**, and **Show agent-opened previews**. See [Browser preview](/docs/developer-workflow/browser-preview) for using a preview during development and [Security and privacy](/docs/configuration/security-privacy) for its limits.

## Project actions and shortcuts

Use **Settings > Project actions** to save tasks such as tests and builds, or services such as a dev server. Choose a discovered project script or enter a custom command. New definitions default to **Only on this device** for that project; **In the project** saves a shareable `.openwaggle/actions.json` file.

Launch actions from **+ Action** in the session header. They run in that session's workspace, which may be a separate worktree. Inspect output, stop or restart a run, and open its ready preview from Session Summary. Choosing an already-running action normally opens its output rather than starting another copy.

The separate **Workspace preparation** section configures setup and cleanup for preparation profiles. Enabled setup must finish before the first agent turn in a new managed worktree. Existing checkouts only run it when you choose **Run setup**. Shared preparation commands need local review and enablement. See [Project actions](/docs/configuration/project-actions) for the full workflow.

Use **Settings > Shortcuts** for both app keyboard bindings and Project Action bindings. **Add binding** lets you choose either kind of command. Review overlap warnings when assigning a shortcut already used elsewhere.

## Worktrees

**Session environment mode** sets the default for new sessions:

- **Current checkout** edits the project folder you opened. This is the shipped default.
- **New worktree** creates a separate Git checkout for the session.

You can choose a different mode before a session's first message. See [Git integration](/docs/developer-workflow/git-integration).

The **Worktrees** list includes every worktree of the opened repository, even ones created outside OpenWaggle. The main checkout is marked `(main)` and cannot be removed here. Use **Refresh** to reload the list or **Remove** on a linked worktree. Normal removal refuses uncommitted changes or locks.

If configured cleanup fails, the worktree stays in the list with its output and **Retry cleanup** controls. **Delete anyway** skips cleanup, which may leave external resources behind. **Force remove** also permits removal of dirty or locked worktrees and can discard uncommitted work. Preserve anything you need before using it.

## Connections

Expand **API Key Providers** to save a key or **OAuth Providers** to sign in through a browser. Under **Available Models**, enable the models you want beside the message box. The selector shows models that are both enabled and available through their provider.

See [Providers and models](/docs/providers/overview) for the full setup.

## MCP

MCP connects the agent to tools and services outside its built-in file and command tools. It starts globally off. In **Settings > MCP**, review each server's definition and requested access before trusting or enabling it.

Activation can differ by session and project. Changes during agent work may remain pending until the turn finishes. Turning a server off does not prove a job already submitted to a remote service has stopped. See [Model Context Protocol](/docs/configuration/mcp) for setup, credentials, and cancellation limits.

## Archived items

Restore archived sessions and conversation branches here, or permanently delete an archived session. Archived branches are hidden from normal sidebar navigation but remain marked in the full Session Tree. Deleting individual branches is not currently available.

## Data storage

OpenWaggle stores app settings and session records under its application-data directory. The active session database is `session-host/session-host.sqlite`. If an older database was migrated, use the explicit [Session recovery](/docs/configuration/session-recovery) commands to inspect or restore its recovery copy.

Other files have separate locations:

| Data | Default location |
|------|------------------|
| Private Project Actions, overrides, and preparation state | Local application storage, scoped to the project and workspace |
| Shared Project Actions and preparation definitions | `<project>/.openwaggle/actions.json` |
| User Waggle presets | `~/.pi/agent/waggle-presets.json` |
| Project Waggle presets | `<project>/.pi/waggle-presets.json` |
| Provider credentials saved through Pi | `~/.pi/agent/auth.json` |
| Global MCP definitions | `~/.openwaggle/mcp.json` |
| Project MCP definitions | `<project>/.mcp.json` and `<project>/.openwaggle/mcp.json` |
| User-owned MCP trust, secret references, OAuth state, and remote task records | `~/.openwaggle/mcp/` |

Credentials may also come from environment variables or custom provider configuration. Do not treat the session database as a complete backup of credentials or project files.

Managed worktrees live outside your project at `~/.openwaggle/worktrees/<repository>/<workspaceId>`. New session worktree branches use `ow/session-<sessionId>`; sessions that share a workspace use the same checkout.

Sidebar sort order, collapsed projects, and the Pinned section's sort are remembered between launches. Pinned sessions and their dragged order are stored with app data. Text filters and state chips are not remembered, so an old filter does not keep hiding sessions.

## Logs

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

The error display can open the logs directory when agent work fails. Review logs for secrets and private project details before sharing them.
