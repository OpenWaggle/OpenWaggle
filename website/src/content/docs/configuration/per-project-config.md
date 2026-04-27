---
title: "Per-Project Configuration"
description: "Project-local OpenWaggle settings and nested Pi runtime settings."
order: 2
section: "Configuration"
---

OpenWaggle reads project-local, per-user configuration from `.openwaggle/settings.json` in the project root. Keep real settings files gitignored; if shared defaults are needed, commit an explicit non-secret template/default file instead.

## Settings File

Top-level keys belong to OpenWaggle. Pi runtime settings live under `pi` and use Pi's JSON setting names.

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

The Pi adapter passes only the nested `pi` object to Pi's `SettingsManager`. Pi's project-local `.pi/settings.json` can also be read by the Pi settings loader, but both real settings files are local runtime configuration and should stay untracked. `.openwaggle/settings.json` is the primary OpenWaggle-facing configuration file.

## Thinking Level

The composer thinking level uses Pi-native values: `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. OpenWaggle stores the selected level and passes it to Pi for each run.

## Runtime Settings

Pi runtime settings belong under the nested `pi` object and follow Pi's JSON setting names.
