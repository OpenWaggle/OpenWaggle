---
title: "Per-Project Configuration"
description: "Project-local settings using .openwaggle/ configuration files."
order: 2
section: "Configuration"
---

OpenWaggle supports per-project configuration through files in the `.openwaggle/` directory at your project root.

## Project Config

`.openwaggle/config.toml` stores shared project settings that are safe to commit to your repository.

### Quality Preset Overrides

Override quality preset parameters per project:

```toml
[quality.low]
temperature = 0.2
max_tokens = 1000

[quality.medium]
temperature = 0.5
max_tokens = 3000

[quality.high]
temperature = 0.7
max_tokens = 8000
```

Only specify the values you want to override — unspecified values use the built-in defaults.

## Local Config

`.openwaggle/config.local.toml` stores machine-specific state like tool trust approvals. This file is automatically excluded from git, so your local trust decisions don't affect other team members.

## Plan Mode

The composer includes a **Plan** toggle that asks the agent to propose a plan before making changes.

- Turn it on from the composer toolbar before sending a message.
- The agent will present a plan and wait for your approval or revision feedback.
- The toggle applies to the current message and resets after sending.
