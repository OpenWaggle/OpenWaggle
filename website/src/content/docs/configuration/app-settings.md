---
title: "App Settings"
description: "Configure providers, Hive controls, agent definitions, permissions, MCP, and worktrees."
order: 1
section: "Configuration"
---

Open Settings from the sidebar gear icon.

Some sidebar preferences are not in Settings because they belong to the sidebar itself. Remembered
between launches: the session sort order, which projects you have collapsed, and the Pinned
section's own sort. Which sessions are pinned, and the order you dragged them into, are stored with
the app's data rather than as a preference. Not remembered: state chips and the text filter, since a
filter that hides sessions should not outlive the reason you applied it.

## Active Sections

| Section | Description |
|---------|-------------|
| **General** | General application settings and automatic context-compaction threshold. |
| **Agents** | Hive controls and project-aware, read-only Markdown agent definitions with enable/disable switches. |
| **Skills** | Browse skills for a selected project. |
| **Permissions** | Default and selected-project access modes, plus saved approvals. |
| **Appearance** | Diff view (unified or split), wrap long lines, and the diff syntax theme, with a live preview. |
| **Waggle Mode** | Multi-agent Waggle configuration and presets. |
| **Extensions** | Manage OpenWaggle and Pi extensions. |
| **MCP** | First-party MCP server configuration, scope, trust, capabilities, and diagnostics. |
| **Worktrees** | Default session environment mode, and the Git worktrees of the opened repository. |
| **Archived items** | Restore archived sessions and non-main session branches, or permanently delete archived sessions. |
| **Connections** | Pi-backed API-key and OAuth provider authentication, plus enabled model selection. |

Every section listed above is active; Settings has no placeholder or disabled areas.

## Agents and Permissions

Settings > Agents puts the Hive controls first. **Agent-created Workers** enables native launch and
spawn for hosted agents. **Workers per parent** defaults to `4` active direct Worker Runs;
**Active agent runs** defaults to `16` across every independent Session and Hive. Both numbers can
be raised without a fixed product cap, but higher values may strain your machine or model provider.
When either capacity is reached, a new Run receives a retryable rejection rather than entering a
hidden queue. Saved Sessions, Follow-ups, searches, waits, and exports do not consume Run slots.
Project configuration files can supersede these defaults. If an older version saved project-specific
Hive overrides, a collapsed **Saved project overrides** list appears below the controls so you can
inspect and clear those saved values. A project configuration file still takes precedence; clearing
a saved preference uses the global value only when no project-file override exists.

Below the controls, choose a project to inspect its agent Markdown definitions, read a file, or
enable/disable a definition for new Sessions. There are no bundled roles and no definition editor:
create or change the Markdown file in the project's agent directory. See
[Agent Definitions](/docs/extending/agent-definitions) for the schema and discovery locations.
Settings > Skills has its own project picker and browser.

Settings > Permissions controls the default access mode and the selected project's override.
Its project picker names the exact project being inspected without changing the active Session.
**Use default** removes an override. The same page lists saved approvals for that project and lets
you revoke them; revocation prevents future use but does not undo previous work.

The CLI is part of the installed app, not a second product to enable in Settings. Packaged macOS
and Linux launches install or refresh the managed `~/.local/bin/openwaggle` command automatically;
the Windows installer provides the command. OpenWaggle never replaces an unrelated file at that
path. If the path is occupied, resolve the conflict explicitly. Ensure `~/.local/bin` is on your
shell's `PATH`. Settings > General shows a read-only warning if the command is missing, outdated,
conflicts with another file, or is not on `PATH`; it has no CLI installation controls. An exact
legacy macOS link to the app remains usable, but re-run the installer if you move the app. From
source, use `pnpm cli:dev -- <command>`.

Archived branches are hidden from normal sidebar navigation but remain visible in the full Session Tree with archived state. Branch deletion is not exposed until Pi supports native branch deletion.

## General

**Context compaction** sets the percentage of the active model's context window at which Pi compacts before another model request. It defaults to **80%** and is one app-global preference for every model, project, and session. Provider capability decides whether Pi uses Native Responses Compaction or the Portable fallback; there is no provider-specific setting.

## Appearance

Settings > Appearance controls how diffs are rendered:

- **Diff view** — Unified or Split. This is not merely a default: it is the same setting the diff panel's own toggle writes, so changing it in either place changes both.
- **Wrap long lines** — Soft-wrap long lines in the diff. Also shared with the panel's toggle.
- **Syntax theme** — Five options with a live preview: **Default**, **Soft**, **Vibrant**, **Protanopia / deuteranopia safe**, and **Tritanopia safe**. The last two avoid red/green and blue/yellow pairings respectively, for colour-vision deficiency.

These are app-global preferences stored in the Session Host database
(`session-host/session-host.sqlite` under OpenWaggle's application-data directory), not per-project
settings.

## Worktrees

Settings > Worktrees has two parts:

- **Session environment mode** — the default for new sessions: **Current checkout** (sessions edit the opened checkout directly) or **New worktree** (each session runs in a dedicated worktree isolated from the checkout). The shipped default is Current checkout. Each session can override it before its first message; see [Git Integration](/docs/developer-workflow/git-integration).
- **Worktrees** — every Git worktree of the opened repository, including the main checkout (marked `(main)`), whether or not OpenWaggle created it. Each linked worktree offers **Remove**; the main checkout cannot be removed. **Refresh** re-reads the list. Removing a worktree with uncommitted changes fails and reports that you must commit, push, or force-remove to discard them.

Like Appearance, the default mode is an app-global preference in the Session Host database.

## Connections

Connections is grouped by authentication method:

- **API key providers** — providers OpenWaggle can configure through Pi auth storage, environment, or custom provider support.
- **OAuth providers** — providers reported by Pi OAuth metadata.
- **Available models** — all models Pi reports, grouped by provider. Enable models here to keep the composer dropdown focused.

The composer only shows enabled models.

## MCP

Settings > MCP controls OpenWaggle's first-party MCP runtime. MCP is globally off by default, and effective state resolves from session to project to global. Turning MCP off for one session means that session receives no MCP servers, tools, instructions, subscriptions, or derived context. A change made during a turn is shown as pending and applies at the next safe turn boundary.

OpenWaggle reads `~/.openwaggle/mcp.json`, `<project>/.mcp.json`, and `<project>/.openwaggle/mcp.json`. Server enablement, trust, grants, and scope state are user-owned state, so a checked-in project file can request a server but cannot silently run or trust it. Per-server toggles do not rewrite or delete the server definition.

The Capabilities area connects lazily. Prompts create editable drafts; resources remain attributed; server instructions are never injected automatically; remote Tasks remain visible when a server is disabled; and MCP Apps use an isolated `ui://` host. Experimental remote Skills require `clientCapabilities.remoteSkills: true` for that server, are digest/frontmatter checked where possible, and never execute remote scripts or grant `allowed-tools` automatically.

## Data Storage

OpenWaggle stores app-owned settings and legacy state under Electron's user-data directory. The
Session Host owns canonical Session state in `session-host/session-host.sqlite` beneath that
directory. After the one-time cutover, a pre-cutover copy remains available only through the
explicit [Session Recovery](/docs/configuration/session-recovery) commands. Waggle presets are
stored by Pi: user-scope presets live in `~/.pi/agent/waggle-presets.json`, and project-scope presets
in `<project>/.pi/waggle-presets.json`.

Session worktrees are created outside your project, at `~/.openwaggle/worktrees/<repository>/<sessionId>`, each on a branch named `ow/session-<sessionId>` — the same id as the directory. Settings > Worktrees lists and removes them.

Provider credentials are resolved by Pi auth storage, environment variables, or project/custom Pi provider configuration. Pi's default auth storage path is `~/.pi/agent/auth.json`.

MCP server config stays in the files above. User-owned MCP state, encrypted secret references, OAuth state, and durable remote Task records live under `~/.openwaggle/mcp/` and are not model-visible.

## Logs

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

The error display can open the logs directory when a run fails.
