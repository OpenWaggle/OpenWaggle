---
title: "App Settings"
description: "OpenWaggle settings sections — general, connections, archived threads, and data storage locations."
order: 1
section: "Configuration"
---

Open Settings via the gear icon in the sidebar or `Cmd+,` / `Ctrl+,`.

## Settings Sections

| Section | Status | Description |
|---------|--------|-------------|
| **General** | Active | General application settings |
| **Waggle Mode** | Active | Multi-agent collaboration configuration (see [Waggle Mode](/docs/using-openwaggle/waggle-mode)) |
| **Connections** | Active | API keys, OAuth subscriptions, provider management |
| **Archived threads** | Active | View, restore, or permanently delete archived conversations |
| Configuration | Disabled placeholder | Not yet available in the current build |
| Personalization | Disabled placeholder | Not yet available in the current build |
| Git | Disabled placeholder | Not yet available in the current build |
| Environments | Disabled placeholder | Not yet available in the current build |
| Worktrees | Disabled placeholder | Not yet available in the current build |

Disabled placeholder sections may still appear in the navigation, but they are not interactive yet.

## Connections

The Connections section manages your AI provider credentials:

- **API key management** — Add, edit, or remove API keys for each provider. Keys are masked in the UI (showing only the last 4 characters).
- **Provider status** — See which providers are connected and active.
- **OAuth subscriptions** — Connect or disconnect OAuth-based provider subscriptions.
- **Encryption status** — API keys are encrypted using your OS keychain. If encryption is unavailable, a warning appears.

## Archived Threads

The Archived threads section lets you:

- **Review archived conversations** grouped by project
- **Restore a thread** back into the active sidebar
- **Delete permanently** when you no longer need the history

In the current UI, archiving happens when you remove a project group from the sidebar. That action archives the group's threads instead of deleting them immediately.

## Execution Modes

Control how the agent handles potentially destructive operations.

| Mode | Behavior |
|------|----------|
| **Default permissions** | File writes, edits, shell commands, and web fetches require your approval unless already trusted by policy. Read-only operations execute immediately. |
| **Full access** | All tools execute immediately without approval prompts. |

Toggle the execution mode via the badge in the composer status bar. Switching to Full access shows a confirmation dialog.

The default for new installations is **Default permissions**.

## Data Storage

### Settings & Conversations

App-owned state is stored in the SQLite app database:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/openwaggle.db` |
| Windows | `%APPDATA%\OpenWaggle\openwaggle.db` |
| Linux | `~/.config/OpenWaggle/openwaggle.db` |

Conversation summaries, messages, and message parts are stored relationally in SQLite for indexed reads and simpler recovery. Orchestration run data also lives in the same database.

### Voice Models

Local Whisper models are cached in:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/models/transformers/` |
| Windows | `%APPDATA%\OpenWaggle\models\transformers\` |
| Linux | `~/.config/OpenWaggle/models/transformers/` |

Models are loaded on demand and idle models are evicted automatically after several minutes of inactivity to keep memory usage under control.

### Logs

Application logs are written to:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Logs/OpenWaggle/` |
| Windows | `%APPDATA%\OpenWaggle\logs\` |
| Linux | `~/.config/OpenWaggle/logs/` |

Access logs quickly via the error display's "Open Logs" button.

### Custom Data Directory

Override the data directory by setting the `OPENWAGGLE_USER_DATA_DIR` environment variable before launching the app.

## Security

### API Key Encryption

API keys are encrypted using your operating system's secure storage:

- **macOS** — Keychain
- **Windows** — Windows Credential Store
- **Linux** — Secret Service (e.g., GNOME Keyring)

If system encryption is unavailable, a warning appears in Settings > Connections prompting you to manually re-save your keys.

### Child Process Environment

When the agent runs shell commands, the child process receives a filtered environment with only safe variables (`PATH`, `HOME`, `SHELL`, `TERM`, `LANG`, `USER`, `TMPDIR`). Your API keys and other sensitive environment variables are never exposed to subprocesses.

### Content Security

- Electron sandbox is enabled.
- Context isolation prevents renderer access to Node.js APIs.
- The preload script provides a controlled, typed API surface.
- Output from commands is scanned for sensitive patterns (API keys, tokens, private keys) and redacted before display.
