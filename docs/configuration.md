# Project Configuration

OpenWaggle uses a project-local, per-user JSON file at `.openwaggle/settings.json`.

The file is optional and should stay gitignored. When absent or unparseable, OpenWaggle falls back to built-in defaults and logs the parse or validation failure. Top-level keys are OpenWaggle-owned product settings. Pi runtime settings live under the nested `pi` object and are passed to Pi through the Pi adapter.

## File Location

```text
your-project/
  .openwaggle/
    settings.json     # Local per-user project settings; do not commit real settings
    skills/           # OpenWaggle project skills loaded by Pi
    extensions/       # OpenWaggle project extensions loaded by Pi when present
    prompts/          # OpenWaggle project prompt templates loaded by Pi when present
    themes/           # OpenWaggle project themes loaded by Pi when present
    agent/
      mcp.json        # Optional OpenWaggle-owned project MCP config
```

Pi's project-local `.pi/settings.json` can also be read by the Pi settings loader. Both real settings files are local runtime configuration and should remain untracked. If a team needs shared defaults, commit an explicit non-secret template/default file instead of a live settings file. `.openwaggle/settings.json` is the user-facing OpenWaggle namespace and wins when both provide the same Pi setting.

OpenWaggle also injects project resource roots into Pi in `.openwaggle > .pi > .agents` order for skills, extensions, prompts, and themes. These implicit roots are stripped again when Pi persists settings so `.openwaggle/settings.json` stays focused on real user/project preferences.

## MCP Configuration

MCP support is powered by OpenWaggle's bundled `pi-mcp-adapter@2.5.4` Pi extension package. Settings > MCP enables or disables the local `extensions/pi-mcp-adapter` package source in global Pi settings without deleting installed package files or MCP config files.

OpenWaggle reads MCP config from all supported project locations and builds the effective runtime config in this order:

1. `~/.config/mcp/mcp.json`
2. `~/.pi/agent/mcp.json`
3. `<project>/.mcp.json`
4. `<project>/.agents/mcp.json`
5. `<project>/.pi/mcp.json`
6. `<project>/.openwaggle/agent/mcp.json`

Later entries override earlier entries by server name and adapter setting key. Disabled server entries are preserved under `openwaggle.disabledMcpServers` in the selected source file, so toggling a server off does not delete its config.

OpenWaggle passes a generated effective MCP config to Pi for each project run. The Pi adapter scopes `pi-mcp-adapter` startup to that generated config and an isolated adapter cwd while binding session extensions, so MCP discovery follows the active project instead of the Electron process cwd. Changes apply from the next turn.

## Shape

```json
{
  "preferences": {
    "model": "openai-codex/gpt-5.5",
    "thinkingLevel": "medium"
  },
  "pi": {
    "treeFilterMode": "default",
    "branchSummary": {
      "skipPrompt": false
    },
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
- Use JSON for project config.

## Runtime Behavior

1. The renderer persists project preferences through typed IPC.
2. The main process updates `.openwaggle/settings.json`.
3. The Pi adapter creates a Pi `SettingsManager` from custom storage.
4. Pi receives only the nested `pi` settings object, merged over `.pi/settings.json` when present.

Project settings are cached by modification time. Edits to `.openwaggle/settings.json` take effect on the next project config read or Pi runtime service creation.

Current Pi-backed UI preferences include Session Tree filter mode through `pi.treeFilterMode` and branch-summary prompt behavior through `pi.branchSummary.skipPrompt`.

## Thinking Level

OpenWaggle stores the composer thinking level as a Pi-native value and passes it to `createAgentSessionFromServices` for each run.

Supported values match Pi:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

Thinking levels control the reasoning depth Pi requests for thinking-capable models.
