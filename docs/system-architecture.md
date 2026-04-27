# System Architecture

OpenWaggle is an Electron desktop agent with a Pi-native runtime core and a SQLite session projection.

## Main Process

The main process owns runtime execution, persistence, provider configuration, auth, and IPC.

Layering follows the hexagonal model:

- `src/main/domain/` contains pure business logic.
- `src/main/ports/` defines Effect service ports such as `AgentKernelService`, `SessionRepository`, `ProviderService`, `TeamsRepository`, and `StandardsService`.
- `src/main/adapters/` implements ports. Pi SDK imports are confined to `src/main/adapters/pi/`.
- `src/main/application/` orchestrates runs through ports.
- `src/main/ipc/` handles Electron IPC and emits transport events.
- `src/main/store/` contains SQLite implementations behind adapters.

## Renderer

The renderer is React 19 + Zustand + Tailwind. It does not consume vendor runtime objects. It receives `AgentTransportEvent` over IPC and reduces those into `UIMessage` state for transcript rendering.

## IPC

`src/shared/types/ipc.ts` is the single contract for invoke/send/event channels. Runtime streaming uses OpenWaggle-owned `AgentTransportEvent`.

## Sessions

Pi sessions and OpenWaggle sessions are projected into:

- `sessions`
- `session_nodes`
- `session_branches`
- `session_branch_state`
- `session_tree_ui_state`

Session trees, branches, Waggle metadata, and future-mode state are explicit projection data over the Pi session graph.

## Waggle

Waggle uses the same session projection as standard mode. Agent turn attribution is stored in message metadata and streamed with Waggle transport metadata; it is not encoded as synthetic transcript tool calls.

## Providers

Pi is the source of truth for provider, model, and auth metadata. The Pi adapter exposes that metadata through OpenWaggle-owned ports and IPC DTOs so renderer code can curate the model picker.

## Standards And Skills

Pi's resource loader is the runtime source of truth for skills and context files. OpenWaggle adds `.openwaggle/skills` to Pi's skill paths inside the Pi adapter and applies OpenWaggle catalog toggles to `.openwaggle/skills` and root `.agents/skills`. `.pi/skills`, ancestor `.agents/skills`, and global/user Pi resources remain Pi-native discovery.

## Security

Electron security remains fail-closed: no renderer Node integration, context isolation on, sandbox on, strict CSP, and IPC through the preload bridge only.
