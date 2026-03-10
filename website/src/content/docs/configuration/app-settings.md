---
title: "App Settings"
description: "OpenWaggle settings — general, connections, waggle mode, archived threads, and data storage."
order: 1
section: "Configuration"
---

Open Settings via the gear icon in the sidebar.

## Settings Sections

| Section | Description |
|---------|-------------|
| **General** | General application settings |
| **Waggle Mode** | Multi-agent collaboration configuration (see [Waggle Mode](/docs/using-openwaggle/waggle-mode)) |
| **Connections** | API keys, OAuth subscriptions, provider management |
| **Archived threads** | View, restore, or permanently delete archived conversations |

Additional settings sections (Configuration, Personalization, Git, Environments, Worktrees) are planned but not yet available.

## Connections

The Connections section manages your AI provider credentials:

- **API key management** — Add, edit, or remove API keys for each provider. Keys are masked in the UI (showing only the last 4 characters).
- **Provider status** — See which providers are connected and active.
- **OAuth subscriptions** — Connect or disconnect OAuth-based provider subscriptions.

API keys are encrypted locally and never leave your machine. If encryption is unavailable, a warning appears.

## Archived Threads

- **Review archived conversations** grouped by project.
- **Restore a thread** back into the active sidebar.
- **Delete permanently** when you no longer need the history.

Archiving happens when you remove a project group from the sidebar — that action archives the group's threads instead of deleting them immediately.

## Execution Modes

Control how the agent handles potentially destructive operations.

| Mode | Behavior |
|------|----------|
| **Default permissions** | File writes, edits, shell commands, and web fetches require your approval. Read-only operations execute immediately. |
| **Full access** | All tools execute immediately without approval prompts. |

Toggle the execution mode via the badge in the composer status bar. Switching to Full access shows a confirmation dialog.

New installations default to **Default permissions**.

## Data Storage

### Settings & Conversations

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\` |
| Linux | `~/.config/OpenWaggle/` |

### Voice Models

Local Whisper models are cached in the app data directory under `models/transformers/`. Models are loaded on demand and unloaded automatically after several minutes of inactivity.

### Logs

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

Access logs quickly via the error display's "Open Logs" button.

## Security

### API Key Encryption

API keys are encrypted using Electron's safeStorage API and stored locally. They never leave your machine. If encryption is unavailable, a warning appears in Settings > Connections.

### Command Environment

When the agent runs shell commands, the child process receives a filtered environment with only safe variables (`PATH`, `HOME`, `SHELL`, etc.). Your API keys and other sensitive environment variables are never exposed to commands the agent runs.
