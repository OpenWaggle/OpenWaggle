---
title: "App Settings"
description: "Current OpenWaggle settings: connections, waggle mode, archived sessions, and storage."
order: 1
section: "Configuration"
---

Open Settings from the sidebar gear icon.

## Active Sections

| Section | Description |
|---------|-------------|
| **General** | General application settings. |
| **Waggle Mode** | Multi-agent team configuration and presets. |
| **Connections** | Pi-backed API-key and OAuth provider authentication, plus enabled model selection. |
| **Archived sessions** | Restore or permanently delete archived sessions grouped by project. |

Configuration, Personalization, Git, Environments, and Worktrees are visible as disabled settings areas but are not active product surfaces yet.

## Connections

Connections is grouped by authentication method:

- **API key providers** — providers OpenWaggle can configure through Pi auth storage, environment, or custom provider support.
- **OAuth providers** — providers reported by Pi OAuth metadata.
- **Available models** — all models Pi reports, grouped by provider. Enable models here to keep the composer dropdown focused.

The composer only shows enabled models.

## Data Storage

OpenWaggle stores app-owned settings, sessions, session projections, and team presets in `openwaggle.db` under Electron's user-data directory.

Provider credentials are resolved by Pi auth storage, environment variables, or project/custom Pi provider configuration. Pi's default auth storage path is `~/.pi/agent/auth.json`.

## Logs

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

The error display can open the logs directory when a run fails.
