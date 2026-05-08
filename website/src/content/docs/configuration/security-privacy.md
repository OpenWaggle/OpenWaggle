---
title: "Security & Privacy"
description: "Current security boundaries for Electron, storage, provider auth, terminal, and Pi tools."
order: 4
section: "Configuration"
---

## Electron Boundary

The renderer runs with:

- Node integration disabled.
- Context isolation enabled.
- Sandbox enabled.
- Strict Content Security Policy.
- Typed IPC through the preload bridge.

## Local Data

OpenWaggle stores app-owned state locally. Settings, sessions, and session projections live in SQLite. Waggle presets live in user-data JSON and project `.openwaggle/settings.json`.

Provider credentials are not owned by the SQLite session projection. They are resolved through Pi auth storage, environment variables, or project/custom provider configuration.

## Voice

Voice transcription runs locally. Audio is not sent to an external speech-to-text provider.

## Terminal And Pi Bash

The integrated terminal uses OpenWaggle's filtered terminal environment.

Pi's `bash` tool is executed by Pi and currently follows Pi SDK shell-environment behavior. Do not assume OpenWaggle's terminal environment filter applies to Pi tool calls.
