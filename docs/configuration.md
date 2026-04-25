# Project Configuration

OpenWaggle uses a single project-local JSON file at `.openwaggle/settings.json`.

The file is optional. When absent or unparseable, OpenWaggle falls back to built-in defaults and logs the parse or validation failure. Top-level keys are OpenWaggle-owned product settings. Pi runtime settings live under the nested `pi` object and are passed to Pi through the Pi adapter.

## File Location

```text
your-project/
  .openwaggle/
    settings.json     # Shared project configuration
    skills/           # OpenWaggle project skills loaded by Pi
    extensions/       # OpenWaggle project extensions loaded by Pi when present
    prompts/          # OpenWaggle project prompt templates loaded by Pi when present
    themes/           # OpenWaggle project themes loaded by Pi when present
```

Pi's project-local `.pi/settings.json` can also be read by the Pi settings loader. `.openwaggle/settings.json` is the user-facing OpenWaggle namespace and wins when both provide the same Pi setting.

## Shape

```json
{
  "preferences": {
    "model": "openai-codex/gpt-5.5",
    "thinkingLevel": "medium"
  },
  "pi": {
    "compaction": {
      "enabled": true,
      "reserveTokens": 16384,
      "keepRecentTokens": 20000
    }
  }
}
```

Rules:

- Top-level keys belong to OpenWaggle.
- `pi` contains Pi-native settings using Pi's JSON setting names.
- Do not add an extra `openwaggle` wrapper.
- Do not use TOML for project config.

## Runtime Behavior

1. The renderer persists project preferences through typed IPC.
2. The main process updates `.openwaggle/settings.json`.
3. The Pi adapter creates a Pi `SettingsManager` from custom storage.
4. Pi receives only the nested `pi` settings object, merged over `.pi/settings.json` when present.

Project settings are cached by modification time. Edits to `.openwaggle/settings.json` take effect on the next project config read or Pi runtime service creation.

## Thinking Level

OpenWaggle stores the composer thinking level as a Pi-native value and passes it to `createAgentSessionFromServices` for each run.

Supported values match Pi:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

Thinking levels control the reasoning depth Pi requests for thinking-capable models. They are not OpenWaggle sampling presets and do not expose separate temperature, top-p, or max-token overrides.
