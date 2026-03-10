---
title: "Per-Project Configuration"
description: "Project-local settings using .openwaggle/config.toml and config.local.toml files."
order: 2
section: "Configuration"
---

OpenWaggle uses two project config files:

- `.openwaggle/config.toml` — shared project settings (safe to commit)
- `.openwaggle/config.local.toml` — local trust/approval state (machine-specific)

## Quality Preset Overrides

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

## Tool Trust

Tool trust approvals are stored in `.openwaggle/config.local.toml`. OpenWaggle also attempts to add this file to `.git/info/exclude` automatically so local trust state does not pollute git status.

## Plan Mode

The composer includes a **Plan** toggle that asks the agent to propose a plan before it starts making changes.

- Turn it on from the composer toolbar before sending a message.
- The agent will present a plan card and wait for **Implement Plan** or revision feedback.
- The toggle applies to the current draft flow and resets after the message is sent.
