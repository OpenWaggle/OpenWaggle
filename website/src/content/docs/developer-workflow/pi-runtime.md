---
title: "Pi runtime"
description: "How OpenWaggle connects Pi's agent execution to desktop tools, session history, and MCP."
order: 4
section: "Developer docs"
---

Pi is the coding-agent runtime inside OpenWaggle. The current source pins Pi **1.0.4** in `pnpm-workspace.yaml`. It handles the model conversation, tool execution, and context compaction. OpenWaggle supplies the desktop interface, session coordination, permissions, and integrations.

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

## Session files

OpenWaggle keeps each session in a normal Pi session file under Pi's agent directory (`~/.pi/agent/sessions/`, one folder per working directory). The SQLite projection is a read model built from that file.

The Session Host also lists Pi sessions that other programs, such as the `pi` CLI, created in an OpenWaggle project or a folder inside it. Every few seconds it reads the first lines of new files in the matching folders: the header, an early `/name`, and the first user message. It never reads whole transcripts to build the list. A listed session is projected the first time it is opened. Before it is shown or continued, OpenWaggle compares the file's size and modification time with the last projection and reads it again if another program appended to it. Runs open the same file, so `pi --resume` continues the same history. Nothing locks the file between programs.

OpenWaggle never rewrites a listed file. A `pi` CLI fork copies the entry ids of the session it came from, so the projection stores a listed session's entries under ids prefixed with its Session id, and translates them back whenever it hands an entry to Pi. Deleting a listed session removes it from OpenWaggle and records the file as dismissed, so it is not listed again; the file stays.

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

MCP runs on Pi's built-in MCP extension. Pi's SDK sessions do not load built-in extensions, so OpenWaggle adds Pi's MCP, codemode, and tool-search extensions to every session it creates, and supplies the extension's plug-in points: the configuration files it reads, the transports it connects with, the store for sign-ins, how the sign-in page opens, and where changes are saved.

Underneath Pi's MCP client, OpenWaggle keeps each session's server connections open between messages, answers server requests for sampling and input, and serves MCP Apps. Every MCP and codemode child call passes through Pi's `tool_call` hook, where OpenWaggle asks for approval. See [Model Context Protocol](/docs/configuration/mcp) for what users see, and `docs/mcp-runtime.md` in the repository for the internals.

## Context and compaction

Context usage comes from Pi `session.getContextUsage()`. Manual compaction calls Pi `session.compact(customInstructions)` and can be requested from the message box with `/compact`. OpenWaggle's Session Host coordinates the activity so reconnecting the UI does not create a second compaction.

For the user-facing controls and tradeoffs, see [Context management](/docs/using-openwaggle/context-management).

See Pi's [SDK guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md#agentsession) and [compaction guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md).
