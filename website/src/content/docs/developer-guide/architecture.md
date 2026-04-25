---
title: "Architecture"
description: "Pi-native OpenWaggle architecture: Electron shell, hexagonal main process, and SQLite session projection."
order: 1
section: "Developer Guide"
---

OpenWaggle is an Electron desktop app with a Pi-native runtime core.

## Process Boundaries

```
src/
  main/              # Node.js process: ports, adapters, IPC, SQLite projection
  preload/           # Typed contextBridge API
  renderer/src/      # React 19 UI
  shared/            # Vendor-free types and schemas
```

The renderer has no direct Node access and no Pi SDK imports. It talks to the main process through typed IPC exposed by preload.

## Hexagonal Main Process

Pi is confined to `src/main/adapters/pi/`.

| Layer | Responsibility |
|-------|----------------|
| `domain/` | Pure business logic. No infrastructure or vendor imports. |
| `ports/` | Effect service interfaces such as `AgentKernelService`, `ProviderService`, and session repositories. |
| `adapters/` | Concrete implementations, including Pi and SQLite adapters. |
| `application/` | Business orchestration through ports. |
| `ipc/` | Transport handlers, active-run tracking, and IPC event emission. |
| `store/` | SQLite persistence primitives behind adapters. |

## Runtime Flow

When a user sends a message:

1. The renderer invokes `agent:send-message`.
2. The IPC handler delegates run coordination to the application layer.
3. `AgentKernelService` resolves to the Pi adapter.
4. The Pi adapter creates project-scoped Pi services for the selected provider-qualified model.
5. Pi runs the session with its native tool surface.
6. The adapter translates Pi events into OpenWaggle-owned `AgentTransportEvent` values.
7. SQLite session projection tables persist sessions, nodes, branches, and branch UI state.

## Provider And Model Metadata

Provider/model/auth data comes from Pi `ModelRegistry` and `AuthStorage`. OpenWaggle exposes that metadata through ports and IPC DTOs so the settings UI can curate enabled models without owning a separate runtime registry.

## Tool Surface

OpenWaggle does not pass a custom initial tool set to Pi and does not add a legacy approval manager. Pi owns tool execution. OpenWaggle renders Pi-emitted tool events.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 40 + electron-vite |
| Runtime | Pi SDK behind OpenWaggle ports/adapters |
| Main orchestration | Effect |
| UI | React 19, Zustand, Tailwind CSS v4 |
| Storage | SQLite + `.openwaggle/settings.json` project config |
| Terminal | xterm.js + node-pty |
