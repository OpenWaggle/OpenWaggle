---
title: "Pi runtime"
description: "How OpenWaggle connects Pi's agent execution to desktop tools, session history, and MCP."
order: 4
section: "Developer docs"
---

Pi is the coding-agent runtime inside OpenWaggle. The current source pins Pi **0.87.1** in `pnpm-workspace.yaml`. It handles the model conversation, tool execution, and context compaction. OpenWaggle supplies the desktop interface, session coordination, permissions, and integrations.

This page is for developers tracing agent execution or extending the app. You do not need to configure Pi separately to use OpenWaggle. For everyday use, start with [Conversations and tools](/docs/using-openwaggle/chat-and-tools); for adding runtime behavior, see [Pi extensions](/docs/extending/pi-extensions).

## Follow a message through the app

When you send a message:

1. OpenWaggle resolves the active project session and selected provider-qualified model.
2. The main process calls the `AgentKernelService` port.
3. The Pi adapter creates project-scoped Pi services.
4. Pi executes the run using its native session, model, auth, tool, and compaction behavior.
5. OpenWaggle translates Pi session events into vendor-free `AgentTransportEvent` values for the renderer.
6. The SQLite projection stores session nodes, branches, and UI read models.

Pi executes the tools enabled for the run. OpenWaggle renders their events in the transcript and applies its session policy through the Pi adapter.

## Tool surface

The default built-in coding tools are:

- `read`
- `bash`
- `edit`
- `write`

OpenWaggle also renders Pi search/listing tools when Pi enables or emits them:

- `grep`
- `find`
- `ls`

OpenWaggle also supplies `powershell`, `sessions`, browser-preview controls, and `project_actions` for managed project tasks. The shell tools receive the Session's prepared environment and authoritative project/worktree paths. `project_actions` lists saved actions and discovered tasks and can start, inspect, read output from, or stop the same managed runs shown in Session Summary. Agent definitions can narrow the active tools with an allowlist; tools are not guaranteed to be identical in every session. New runtime tools should use Pi extension APIs behind OpenWaggle's adapter boundaries.

Pi documents its default tool controls in the [coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#tool-options).

## MCP integration

OpenWaggle owns MCP configuration, trust, authentication, protocol negotiation, transports, lifecycle, and capability policy behind `McpConfigService` and `McpRuntimeService`. The first-party runtime negotiates the current MCP revision and supported legacy revisions, then exposes a compact `mcp` gateway, confined `mcp_run` orchestration, and explicitly opted-in direct tools to Pi through an internal extension factory.

`mcp_run` parses a documented JavaScript-like DSL; it never evaluates JavaScript or exposes Node/Electron authority. The DSL supports immutable variables, sequential calls, bounded parallel groups, result-property flow, conditions, and return values. Its wall-time, step, call-count, depth, memory, output, and concurrency budgets are hard limits, and every child call keeps its own approval and provenance. See [Bounded `mcp_run` orchestration](/docs/configuration/mcp#bounded-mcp_run-orchestration) for the exact grammar and limits.

The bundled Pi model contract does not expose a per-model tool-support flag. `Model<Api>` is the tool-capable chat-model contract: `Context` carries tools, Pi's coding agent supplies them by default, and all installed built-in API implementations consume them. OpenWaggle therefore gates agent MCP tools on successful `ModelRegistry` resolution and never guesses from provider or model names. A custom API registered as a Pi model must honor the same tool and tool-call event contract or its run fails visibly.

The turn snapshot is immutable. Scope or server changes made during an active turn apply at the next safe boundary. Pi remains the agent/model loop and OpenWaggle does not create a second agent runtime; MCP calls are infrastructure used by the Pi-backed run.

## Context and compaction

Context usage comes from Pi `session.getContextUsage()`. Manual compaction calls Pi `session.compact(customInstructions)` and can be requested from the message box with `/compact`. OpenWaggle's Session Host coordinates the activity so reconnecting the UI does not create a second compaction.

For the user-facing controls and tradeoffs, see [Context management](/docs/using-openwaggle/context-management).

See Pi's [SDK guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md#agentsession) and [compaction guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md).
