---
title: "Per-Project Configuration"
description: "Project-local OpenWaggle settings and nested Pi runtime settings."
order: 2
section: "Configuration"
---

OpenWaggle reads project-local configuration from `.openwaggle/settings.json` in the project root.

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

The Pi adapter passes only the nested `pi` object to Pi's `SettingsManager`. Pi's project-local `.pi/settings.json` can also be read by the Pi settings loader, but `.openwaggle/settings.json` is the primary OpenWaggle-facing configuration file.

## Thinking Level

The composer thinking level uses Pi-native values: `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. OpenWaggle stores the selected level and passes it to Pi for each run. It is not a custom OpenWaggle quality preset and does not configure separate temperature, top-p, or max-token values.

## Runtime Limits

The current Pi-native baseline does not include project-local tool trust approvals or a Plan Mode toggle.
