# Settings & Configuration

## App Settings

Open Settings via the gear icon in the sidebar or `Cmd+,` / `Ctrl+,`.

### Settings Sections

| Section | Status | Description |
|---------|--------|-------------|
| **General** | Active | General application settings |
| **Waggle Mode** | Active | Multi-agent collaboration configuration (see [Waggle Mode](./waggle-mode.md)) |
| **Connections** | Active | API keys, OAuth subscriptions, provider management |
| Configuration | Planned | Advanced configuration options |
| Personalization | Planned | UI themes and customization |
| Git | Planned | Git-specific settings |
| Environments | Planned | Environment management |
| Worktrees | Planned | Git worktree management |
| Archived threads | Planned | View and restore archived conversations |

### Connections

The Connections section manages your AI provider credentials:

- **API key management** — Add, edit, or remove API keys for each provider. Keys are masked in the UI (showing only the last 4 characters).
- **Provider status** — See which providers are connected and active.
- **OAuth subscriptions** — Connect or disconnect OAuth-based provider subscriptions.
- **Encryption status** — API keys are encrypted using your OS keychain. If encryption is unavailable, a warning appears.

## Execution Modes

Control how the agent handles potentially destructive operations.

| Mode | Behavior |
|------|----------|
| **Default permissions** (sandbox) | File writes, edits, and shell commands require your approval. Read-only operations execute immediately. |
| **Full access** | All tools execute immediately without approval prompts. |

Toggle the execution mode via the badge in the composer status bar. Switching to Full access shows a confirmation dialog.

The default for new installations is **Default permissions**. Existing installations that predated this feature retain **Full access** until explicitly changed.

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

`writeFile` trust approvals are stored in `.openwaggle/config.local.toml`. OpenWaggle also attempts to add this file to `.git/info/exclude` automatically so local trust state does not pollute git status.

## Orchestration Modes

OpenWaggle supports different execution strategies for processing your requests:

| Mode | Behavior |
|------|----------|
| **Auto-fallback** | Starts with orchestrated multi-step planning. Falls back to classic single-agent if planning fails. This is the default. |
| **Orchestrated** | Always uses the multi-step orchestration pipeline (planner + executor). |
| **Classic** | Always uses direct single-agent execution (no planning step). |

### How Orchestration Works

In orchestrated mode:

1. **Planning** — An LLM generates a task graph with dependencies.
2. **Execution** — Tasks run in dependency order. Independent tasks can run in parallel.
3. **Fallback** — If orchestration setup fails, falls back to classic mode automatically (in auto-fallback mode).

Orchestration runs are persisted separately from conversation history and can be viewed inline in the chat.

## Data Storage

### Settings

Settings are stored via `electron-store` in your OS configuration directory:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/settings.json` |
| Windows | `%APPDATA%\OpenWaggle\settings.json` |
| Linux | `~/.config/OpenWaggle/settings.json` |

### Conversations

Conversations are stored as individual JSON files:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/conversations/` |
| Windows | `%APPDATA%\OpenWaggle\conversations\` |
| Linux | `~/.config/OpenWaggle/conversations/` |

Each conversation is a separate `{id}.json` file. A lightweight `index.json` provides fast loading of conversation summaries without reading every file.

### Orchestration Runs

Orchestration run data is stored separately:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/orchestration-runs/` |
| Windows | `%APPDATA%\OpenWaggle\orchestration-runs\` |
| Linux | `~/.config/OpenWaggle/orchestration-runs/` |

### Voice Models

Local Whisper models are cached in:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/OpenWaggle/models/transformers/` |
| Windows | `%APPDATA%\OpenWaggle\models\transformers\` |
| Linux | `~/.config/OpenWaggle/models\transformers\` |

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
