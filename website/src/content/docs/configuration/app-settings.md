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
| **Waggle Mode** | Multi-agent Waggle configuration and presets. |
| **MCP** | Pi extension-backed MCP server configuration, source hierarchy, and toggles. |
| **Connections** | Pi-backed API-key and OAuth provider authentication, plus enabled model selection. |
| **Archived items** | Restore archived sessions and non-main session branches, or permanently delete archived sessions. |

Configuration, Personalization, Git, Environments, and Worktrees are visible as disabled settings areas but are not active product surfaces yet.

Archived branches are hidden from normal sidebar navigation but remain visible in the full Session Tree with archived state. Branch deletion is not exposed until Pi supports native branch deletion.

## Connections

Connections is grouped by authentication method:

- **API key providers** — providers OpenWaggle can configure through Pi auth storage, environment, or custom provider support.
- **OAuth providers** — providers reported by Pi OAuth metadata.
- **Available models** — all models Pi reports, grouped by provider. Enable models here to keep the composer dropdown focused.

The composer only shows enabled models.

## MCP

Settings > MCP enables OpenWaggle's bundled `pi-mcp-adapter@2.5.4` through the local `extensions/pi-mcp-adapter` Pi extension package source and shows the merged effective MCP view. OpenWaggle reads standard, Pi, `.agents`, and `.openwaggle/agent/mcp.json` config files, then passes Pi a generated effective config for the next turn. Runtime adapter startup is scoped to that generated config and the active project so MCP servers do not depend on the Electron launcher cwd.

Per-server toggles preserve config by moving entries between `mcpServers` and `openwaggle.disabledMcpServers` in the selected source file. The advanced JSON editor remains available for every `pi-mcp-adapter` field.

## Data Storage

OpenWaggle stores app-owned settings, sessions, and session projections in `openwaggle.db` under Electron's user-data directory. Global Waggle presets live in `waggle-presets.json` under the same user-data directory, and project Waggle presets live in `.openwaggle/settings.json`.

Provider credentials are resolved by Pi auth storage, environment variables, or project/custom Pi provider configuration. Pi's default auth storage path is `~/.pi/agent/auth.json`.

MCP server config files stay in their standard/project locations and are not stored in the SQLite settings database.

## Logs

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

The error display can open the logs directory when a run fails.
