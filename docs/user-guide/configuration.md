# Settings & Configuration

## App Settings

Open Settings via the gear icon in the sidebar or `Cmd+,` / `Ctrl+,`.

### Settings Sections

| Section | Status | Description |
|---------|--------|-------------|
| **General** | Active | General application settings |
| **Waggle Mode** | Active | Multi-agent collaboration configuration (see [Waggle Mode](./waggle-mode.md)) |
| **Connections** | Active | API keys, OAuth subscriptions, provider management |
| **Archived threads** | Active | View, restore, or permanently delete archived conversations |
| Configuration | Disabled placeholder | Not yet available in the current build |
| Personalization | Disabled placeholder | Not yet available in the current build |
| Git | Disabled placeholder | Not yet available in the current build |
| Environments | Disabled placeholder | Not yet available in the current build |
| Worktrees | Disabled placeholder | Not yet available in the current build |

Disabled placeholder sections may still appear in the navigation, but they are not interactive yet.

### Connections

The Connections section manages your AI provider credentials:

- **API key management** — Add, edit, or remove API keys for each provider. Keys are masked in the UI (showing only the last 4 characters).
- **Provider status** — See which providers are connected and active.
- **OAuth subscriptions** — Connect or disconnect OAuth-based provider subscriptions.
- **Encryption status** — API keys are encrypted using your OS keychain. If encryption is unavailable, a warning appears.

### Archived Threads

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

## Quality Presets

The quality preset controls the AI model's generation parameters. Select it from the composer toolbar.

| Preset | Temperature | Top P | Max Tokens |
|--------|------------|-------|------------|
| **Low** | 0.25 | 0.9 | 1,200 |
| **Medium** | 0.4 | 0.95 | 2,200 |
| **High** | 0.55 | 1.0 | 4,200 |

**What these parameters control:**

- **Temperature** — Higher values produce more creative/varied responses. Lower values are more deterministic.
- **Top P** — Controls diversity of token selection. Lower values focus on high-probability tokens.
- **Max Tokens** — Maximum length of the response.

Some providers have additional behavior:
- **Anthropic** — Quality preset also controls the extended thinking budget (more thinking tokens at higher quality).
- **OpenAI reasoning models** — Quality maps to reasoning effort level instead of temperature (reasoning models don't use temperature).

## Per-Project Configuration

OpenWaggle uses two project config files:

- `.openwaggle/config.toml` — shared project settings (safe to commit)
- `.openwaggle/config.local.toml` — local trust/approval state (machine-specific)

Override quality preset parameters per project in `.openwaggle/config.toml`:

```toml
[quality.low]
temperature = 0.2
top_p = 0.85
max_tokens = 1000

[quality.medium]
temperature = 0.5
top_p = 0.95
max_tokens = 3000

[quality.high]
temperature = 0.7
top_p = 1.0
max_tokens = 8000
```

Only specify the values you want to override — unspecified values use the built-in defaults. Invalid values are silently ignored. Config files are cached by file modification time and reloaded at the start of each agent run.

Tool trust approvals are stored in `.openwaggle/config.local.toml`. OpenWaggle also attempts to add this file to `.git/info/exclude` automatically so local trust state does not pollute git status.

## Plan Mode

The composer includes a **Plan** toggle that asks the agent to propose a plan before it starts making changes.

- Turn it on from the composer toolbar before sending a message.
- The agent will present a plan card and wait for **Implement Plan** or revision feedback.
- The toggle applies to the current draft flow and resets after the message is sent.

## Data Storage

### Settings

App-owned settings are stored in the SQLite app database:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/openwaggle.db` |
| Windows | `%APPDATA%\OpenWaggle\openwaggle.db` |
| Linux | `~/.config/OpenWaggle/openwaggle.db` |

### Conversations

Conversations are stored in the same SQLite app database:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/openwaggle.db` |
| Windows | `%APPDATA%\OpenWaggle\openwaggle.db` |
| Linux | `~/.config/OpenWaggle/openwaggle.db` |

Conversation summaries, messages, and message parts are stored relationally in SQLite for indexed reads and simpler recovery.

### Orchestration Runs

Orchestration run data also lives in SQLite:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/openwaggle.db` |
| Windows | `%APPDATA%\OpenWaggle\openwaggle.db` |
| Linux | `~/.config/OpenWaggle/openwaggle.db` |

OpenWaggle stores orchestration events in an append-only event table and keeps query-friendly run/task read models alongside them.

If you need to inspect the raw database as a maintainer, see the SQLite access guide in [Developer Guide](./developer-guide.md#inspecting-the-sqlite-database).

### Voice Models

Local Whisper models are cached in:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/models/transformers/` |
| Windows | `%APPDATA%\OpenWaggle\models\transformers\` |
| Linux | `~/.config/OpenWaggle/models\transformers\` |

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
