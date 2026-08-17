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

## MCP Integration

OpenWaggle owns MCP configuration, trust, authentication, protocol negotiation, transports, lifecycle, and capability policy behind `McpConfigService` and `McpRuntimeService`. The first-party runtime negotiates the current MCP revision and supported legacy revisions, then exposes a compact `mcp` gateway, confined `mcp_run` orchestration, and explicitly opted-in direct tools to Pi through an internal extension factory.

`mcp_run` parses a documented JavaScript-like DSL; it never evaluates JavaScript or exposes Node/Electron authority. The DSL supports immutable variables, sequential calls, bounded parallel groups, result-property flow, conditions, and return values. Its wall-time, step, call-count, depth, memory, output, and concurrency budgets are hard limits, and every child call keeps its own approval and provenance. See [Bounded `mcp_run` orchestration](/docs/configuration/mcp#bounded-mcp_run-orchestration) for the exact grammar and limits.

Pi 0.80.6 does not expose a per-model tool-support flag. `Model<Api>` is the tool-capable chat-model contract: `Context` carries tools, Pi's coding agent supplies them by default, and all installed built-in API implementations consume them. OpenWaggle therefore gates agent MCP tools on successful `ModelRegistry` resolution and never guesses from provider or model names. A custom API registered as a Pi model must honor the same tool and tool-call event contract or its run fails visibly.

The turn snapshot is immutable. Scope or server changes made during an active turn apply at the next safe boundary. Pi remains the agent/model loop and OpenWaggle does not create a second agent runtime; MCP calls are infrastructure used by the Pi-backed run.

## Context And Compaction

Context usage comes from Pi `session.getContextUsage()`. Manual compaction calls Pi `session.compact(customInstructions)` and is triggered from the composer with `/compact`.

See Pi's [SDK guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md#agentsession) and [compaction guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md).
