---
title: "Architecture"
description: "Find the main processes, session owner, runtime adapter, and UI boundaries in the OpenWaggle source."
order: 3
section: "Developer docs"
---

Use this guide to find where a change belongs in the source. OpenWaggle uses Electron for the desktop app and Pi for agent execution. The local Session Host owns session execution and saved state; the desktop UI and CLI act as clients.

For setup commands, see [Building from source](/docs/developer-guide/building-from-source). For the Pi integration, see [Pi runtime](/docs/developer-workflow/pi-runtime).

## Process boundaries

```
src/
  main/              # Node.js process: ports, adapters, IPC, SQLite projection
  preload/           # Typed contextBridge API
  renderer/src/      # React 19 UI
  shared/            # Vendor-free types and schemas
```

The renderer has no direct Node access and no Pi SDK imports. It talks to the main process through typed IPC exposed by preload.

## Hexagonal main process

The main process separates business logic from infrastructure through ports and adapters. App-level Pi SDK imports stay in `src/main/adapters/pi/`; dedicated `packages/pi-*` packages can use Pi within their own boundaries.

| Layer | Responsibility |
|-------|----------------|
| `domain/` | Pure business logic. No infrastructure or vendor imports. |
| `ports/` | Effect service interfaces such as `AgentKernelService`, `ProviderService`, and session repositories. |
| `adapters/` | Concrete implementations, including Pi and SQLite adapters. |
| `application/` | Business orchestration through ports. |
| `ipc/` | Input validation, calls to application services, and IPC responses/events. |
| `store/` | SQLite persistence primitives behind adapters. |

## Runtime flow

When a user sends a message:

1. The renderer invokes `agent:send-message`.
2. The IPC handler delegates to application services. Session commands route to the owning Session Host.
3. `AgentKernelService` resolves to the Pi adapter.
4. The Pi adapter creates project-scoped Pi services for the selected provider-qualified model.
5. Pi runs the session with the tools enabled for that run.
6. The adapter translates Pi events into OpenWaggle-owned `AgentTransportEvent` values.
7. Pi session history remains the runtime record. SQLite projection tables store the sessions, nodes, branches, and UI state needed for navigation and display.

The renderer reads the session projection through OpenWaggle-owned IPC DTOs. Session Tree selection, branch rows, draft branch state, and route `branch`/`node` search parameters are UI over that projection rather than direct Pi SDK objects.

## Provider and model metadata

Provider/model/auth data comes from Pi `ModelRuntime`. OpenWaggle exposes that metadata through ports and IPC DTOs so the settings UI can curate enabled models.

## Tool surface

Pi owns tool execution. OpenWaggle renders Pi-emitted tool events directly in the transcript.

## Project resources

OpenWaggle injects project resource roots into Pi in `.openwaggle > .pi > .agents` order for skills, extensions, prompts, and themes. Eligible extension packages can add declared roots before `.pi`; managed extension code also requires package lifecycle approval. Skill toggles filter the loaded skill list, including matching names outside the app's two catalog roots. Pi still handles resource loading.

## Managed Actions and workspace preparation

`ActionRunService` owns managed task and service processes, output, and stop/restart behavior.
`WorkspacePreparationService` owns setup, cleanup, and prepared environment state. The Pi adapter
prepares the Session's bound workspace before execution and passes the prepared environment to its
shell tools. Native `project_actions` calls and GUI controls use these same Host services, rather
than typing commands into a terminal pane.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 43 + electron-vite |
| Runtime | Pi SDK behind OpenWaggle ports/adapters |
| Main orchestration | Effect |
| UI | React 19, Zustand, Tailwind CSS v4 |
| Storage | SQLite read models and local state, Pi JSONL runtime history, and `.openwaggle/settings.json` project configuration; native Actions use `.openwaggle/actions.json` |
| Terminal | xterm.js + node-pty |
