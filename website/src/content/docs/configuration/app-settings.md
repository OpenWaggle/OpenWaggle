---
title: "App Settings"
description: "Current OpenWaggle settings: connections, MCP, waggle mode, archived sessions and branches, and storage."
order: 1
section: "Configuration"
---

Open Settings from the sidebar gear icon.

## Active Sections

| Section | Description |
|---------|-------------|
| **General** | General application settings. |
| **Appearance** | Diff view (unified or split), wrap long lines, and the diff syntax theme, with a live preview. |
| **Waggle Mode** | Multi-agent Waggle configuration and presets. |
| **Extensions** | Manage OpenWaggle and Pi extensions. |
| **MCP** | Pi extension-backed MCP server configuration, source hierarchy, and toggles. |
| **Worktrees** | Default session environment mode, and the Git worktrees of the opened repository. |
| **Archived items** | Restore archived sessions and non-main session branches, or permanently delete archived sessions. |
| **Connections** | Pi-backed API-key and OAuth provider authentication, plus enabled model selection. |

Every section listed above is active; Settings has no placeholder or disabled areas.

Archived branches are hidden from normal sidebar navigation but remain visible in the full Session Tree with archived state. Branch deletion is not exposed until Pi supports native branch deletion.

## Appearance

Settings > Appearance controls how diffs are rendered:

- **Diff view** — Unified or Split. This is not merely a default: it is the same setting the diff panel's own toggle writes, so changing it in either place changes both.
- **Wrap long lines** — Soft-wrap long lines in the diff. Also shared with the panel's toggle.
- **Syntax theme** — Five options with a live preview: **Default**, **Soft**, **Vibrant**, **Protanopia / deuteranopia safe**, and **Tritanopia safe**. The last two avoid red/green and blue/yellow pairings respectively, for colour-vision deficiency.

These are app-global preferences stored in `openwaggle.db`, not per-project settings.

## Worktrees

Settings > Worktrees has two parts:

- **Session environment mode** — the default for new sessions: **Current checkout** (sessions edit the opened checkout directly) or **New worktree** (each session runs in a dedicated worktree isolated from the checkout). The shipped default is Current checkout. Each session can override it before its first message; see [Git Integration](/docs/developer-workflow/git-integration).
- **Worktrees** — every Git worktree of the opened repository, including the main checkout (marked `(main)`), whether or not OpenWaggle created it. Each linked worktree offers **Remove**; the main checkout cannot be removed. **Refresh** re-reads the list. Removing a worktree with uncommitted changes fails and reports that you must commit, push, or force-remove to discard them.

Like Appearance, the default mode is an app-global preference in `openwaggle.db`.

## Connections

Connections is grouped by authentication method:

- **API key providers** — providers OpenWaggle can configure through Pi auth storage, environment, or custom provider support.
- **OAuth providers** — providers reported by Pi OAuth metadata.
- **Available models** — all models Pi reports, grouped by provider. Enable models here to keep the composer dropdown focused.

The composer only shows enabled models.

## MCP

Settings > MCP enables OpenWaggle's bundled `pi-mcp-adapter@2.9.0` through the local `extensions/pi-mcp-adapter` Pi extension package source and shows the merged effective MCP view. OpenWaggle reads standard, Pi, `.agents`, and `.openwaggle/agent/mcp.json` config files, then passes Pi a generated effective config for the next turn. Runtime adapter startup is scoped to that generated config and the active project so MCP servers do not depend on the Electron launcher cwd.

Per-server toggles preserve config by moving entries between `mcpServers` and `openwaggle.disabledMcpServers` in the selected source file. The advanced JSON editor remains available for every `pi-mcp-adapter` field.

## Data Storage

OpenWaggle stores app-owned settings, sessions, and session projections in `openwaggle.db` under Electron's user-data directory. Waggle presets are stored by Pi, not in the user-data directory: user-scope presets live in `~/.pi/agent/waggle-presets.json`, and project-scope presets in `<project>/.pi/waggle-presets.json`.

Session worktrees are created outside your project, at `~/.openwaggle/worktrees/<repository>/<sessionId>`, each on a branch named `ow/session-<short-session-id>`. Settings > Worktrees lists and removes them.

Provider credentials are resolved by Pi auth storage, environment variables, or project/custom Pi provider configuration. Pi's default auth storage path is `~/.pi/agent/auth.json`.

MCP server config files stay in their standard/project locations and are not stored in the SQLite settings database.

## Logs

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

The error display can open the logs directory when a run fails.
