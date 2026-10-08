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

OpenWaggle keeps each session in a normal Pi session file where the `pi` CLI keeps them: by default under Pi's agent directory (`~/.pi/agent/sessions/`, one folder per working directory), or in the directory named by `PI_CODING_AGENT_SESSION_DIR` or the `sessionDir` setting in the project's `.pi/settings.json` or the global Pi settings. The SQLite projection is a read model built from that file.

The Session Host also lists Pi sessions that other programs, such as the `pi` CLI, created in an OpenWaggle project or a folder inside it. Every few seconds it looks in those directories for files it does not know and reads only their first lines: the header, an early `/name`, and the first user message. It finds the header the way Pi does, skipping blank or malformed lines for up to 1 MiB, and does not read a file again until the file changes. A file written in the last few seconds waits for the next pass, and one pass lists at most 100 sessions. A file whose Session cannot be created, for example because the project's settings file is broken, is tried again after a minute, then less often. While a project is being removed, discovery leaves it alone.

A listed session is projected the first time it is opened. OpenWaggle keeps the size and modification time of the file each projection came from, so before a session is shown, read through the Sessions tool, or continued, one `stat` tells it whether another program changed the file; if so, it reads the file again. Nothing locks the file between programs.

Viewing a listed session never changes its file. The projection, the context meter, and other reads load the file's entries into memory and bind no extensions. A Run continues the file through Pi, as `pi --resume` would, so a file in an older Pi format is upgraded to Pi's current format when you first continue it. Runs work in the folder the session ran in when that folder is inside the project, and start with the model and thinking level `pi --resume` would pick: the branch's model selection, and its last thinking level or Pi's `defaultThinkingLevel` for the session's folder (project over global), clamped to the model. A listed session's title follows its latest `/name` until the user renames it.

A `pi` CLI fork copies the entry ids of the session it came from, and OpenWaggle stores every Session's nodes under one key. The projection therefore stores a listed session's entries under ids prefixed with its Session id, and translates them back whenever it hands an entry to Pi. Deleting a listed session removes it from OpenWaggle and records the file as dismissed, so it is not listed again; the file stays. Removing the project deletes its sessions from OpenWaggle without dismissing their files, so they are listed again if the folder is added back.

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
