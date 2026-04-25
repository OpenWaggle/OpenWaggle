# Architecture

OpenWaggle is an Electron desktop coding agent built around a Pi-native runtime boundary.

## Process Boundaries

- **Main** (`src/main/`) owns Pi runtime adapters, persistence, and IPC handlers.
- **Preload** (`src/preload/`) exposes the typed `window.api` bridge and contains no business logic.
- **Renderer** (`src/renderer/src/`) is a React 19 + Zustand UI that consumes OpenWaggle-owned IPC events.
- **Shared** (`src/shared/`) contains vendor-free IPC, stream, session, message, and configuration types.

## Runtime Boundary

Application services depend on `AgentKernelService`, not Pi SDK directly. `src/main/adapters/pi/` is the only place that imports `@mariozechner/pi-coding-agent`.

Pi SDK reference: [Pi SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md).

The standard run path is:

1. IPC handler receives a send request and registers cancellation/stream state.
2. `agent-run-service.ts` validates the project-scoped model and loads the session projection through ports.
3. `AgentKernelService.run()` opens or creates the Pi session and prompts it.
4. Pi session events are translated once into `AgentTransportEvent`.
5. The renderer reduces those transport events into live UI messages.
6. Completed Pi messages are projected into SQLite `sessions`, `session_nodes`, and branch tables.

OpenWaggle keeps Pi's resource loader as the runtime source of truth. The Pi adapter adds `.openwaggle/skills` as an additional skill path and applies OpenWaggle catalog toggles to `.openwaggle/skills` and root `.agents/skills`, while Pi continues to load `.pi/skills`, `.agents/skills`, and global/user resources through its native discovery.

## Persistence

SQLite stores OpenWaggle's product projection:

- `sessions`
- `session_nodes`
- `session_branches`
- `session_branch_state`
- `session_tree_ui_state`
- lightweight run, settings, and team preset read models

## Provider Model

Pi is the provider/model/auth source of truth. OpenWaggle does not maintain a product-owned provider registry. The Pi adapter reads `ModelRegistry` and `AuthStorage`, then exposes vendor-free DTOs through `ProviderService` and IPC so the renderer can show provider logos, auth method groups, and the user-curated model selector.

Model identity is provider-qualified (`provider/modelId`). The same hosted model id can appear under several providers, and OpenWaggle treats each provider/model pair as a distinct runtime option.

## Hexagonal Rule

Pi SDK and vendor imports stay in adapters. Domain, application, IPC, ports, shared types, and renderer code use OpenWaggle-owned types.
