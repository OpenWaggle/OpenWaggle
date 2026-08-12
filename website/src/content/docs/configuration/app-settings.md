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
| **MCP** | First-party MCP server configuration, scope, trust, capabilities, and diagnostics. |
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

Settings > MCP controls OpenWaggle's first-party MCP runtime. MCP is globally off by default, and effective state resolves from session to project to global. Turning MCP off for one session means that session receives no MCP servers, tools, instructions, subscriptions, or derived context. A change made during a turn is shown as pending and applies at the next safe turn boundary.

OpenWaggle reads `~/.openwaggle/mcp.json`, `<project>/.mcp.json`, and `<project>/.openwaggle/mcp.json`. Server enablement, trust, grants, and scope state are user-owned state, so a checked-in project file can request a server but cannot silently run or trust it. Per-server toggles do not rewrite or delete the server definition.

The Capabilities area connects lazily. Prompts create editable drafts; resources remain attributed; server instructions are never injected automatically; remote Tasks remain visible when a server is disabled; and MCP Apps use an isolated `ui://` host. Experimental remote Skills require `clientCapabilities.remoteSkills: true` for that server, are digest/frontmatter checked where possible, and never execute remote scripts or grant `allowed-tools` automatically.

## Data Storage

OpenWaggle stores app-owned settings, sessions, and session projections in `openwaggle.db` under Electron's user-data directory. Global Waggle presets live in `waggle-presets.json` under the same user-data directory, and project Waggle presets live in `.openwaggle/settings.json`.

Provider credentials are resolved by Pi auth storage, environment variables, or project/custom Pi provider configuration. Pi's default auth storage path is `~/.pi/agent/auth.json`.

MCP server config stays in the files above. User-owned MCP state, encrypted secret references, OAuth state, and durable remote Task records live under `~/.openwaggle/mcp/` and are not model-visible.

## Logs

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

The error display can open the logs directory when a run fails.
