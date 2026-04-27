---
title: "Built-in Terminal"
description: "The integrated xterm.js terminal for project-local commands."
order: 2
section: "Developer Workflow"
---

OpenWaggle includes an integrated terminal for commands you run yourself.

## Opening The Terminal

Use `Cmd+J` on macOS or `Ctrl+J` on Windows/Linux. You can also use the terminal button in the header.

## Behavior

- Runs in the selected project directory.
- Uses xterm.js with node-pty.
- Persists while the workspace is open.
- Is separate from Pi's agent `bash` tool.

## Environment

The integrated terminal receives OpenWaggle's filtered terminal environment.

Pi's `bash` tool is different: it is executed by Pi during an agent run and currently follows Pi SDK shell-environment behavior.
