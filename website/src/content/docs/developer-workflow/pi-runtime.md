---
title: "Pi Runtime"
description: "How OpenWaggle uses Pi as the native coding-agent runtime."
order: 3
section: "Developer Workflow"
---

OpenWaggle is a desktop UI shell over Pi's coding-agent runtime.

Pi SDK reference: [Pi SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md).

When you send a message:

1. OpenWaggle resolves the active project session and selected provider-qualified model.
2. The main process calls the `AgentKernelService` port.
3. The Pi adapter creates project-scoped Pi services.
4. Pi executes the run using its native session, model, auth, tool, and compaction behavior.
5. OpenWaggle translates Pi session events into vendor-free `AgentTransportEvent` values for the renderer.
6. The SQLite projection stores session nodes, branches, and UI read models.

OpenWaggle lets Pi choose the active runtime tool surface and renders Pi tool events directly in the transcript.

Pi documents the default tool controls in the [coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#tool-options). Future runtime customization should use Pi-native extension points behind OpenWaggle ports.

## Tool Surface

OpenWaggle does not choose an explicit tool allowlist. With the current Pi SDK defaults, the initial built-in tools are:

- `read`
- `bash`
- `edit`
- `write`

OpenWaggle also renders Pi search/listing tools when Pi enables or emits them:

- `grep`
- `find`
- `ls`

Tool availability and behavior are Pi runtime concerns. OpenWaggle's job is to render the events truthfully.

## MCP Extension

MCP support is a Pi extension-backed capability. OpenWaggle ships `pi-mcp-adapter@2.5.4` as a bundled dependency, enables the local `extensions/pi-mcp-adapter` package source in global Pi settings, merges all supported MCP config sources for the active project, and passes a generated effective config to Pi through extension flags. Because the adapter reads config during extension load and initializes in `session_start`, OpenWaggle scopes adapter startup and session binding to the generated config and an isolated adapter cwd.

OpenWaggle does not run a separate MCP tool executor beside Pi. `/mcp` and `/mcp-auth` remain adapter commands handled inside Pi, while Settings > MCP provides desktop controls for package enablement, source editing, and per-server toggles.

## Context And Compaction

Context usage comes from Pi `session.getContextUsage()`. Manual compaction calls Pi `session.compact(customInstructions)` and is triggered from the composer with `/compact`.

See Pi's [SDK guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md#agentsession) and [compaction guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md).
