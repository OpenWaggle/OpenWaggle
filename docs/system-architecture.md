# System Architecture

OpenWaggle is an Electron desktop agent with a Pi-native runtime core and a SQLite session projection.

## Main Process

The main process owns runtime execution, persistence, provider configuration, auth, and IPC.

Layering follows the hexagonal model:

- `src/main/domain/` contains pure business logic.
- `src/main/ports/` defines Effect service ports such as `AgentKernelService`, `SessionRepository`, `SessionProjectionRepository`, `SessionTreePreferencesService`, `ProviderService`, `ProviderAuthService`, `ProviderOAuthService`, `ProviderProbeService`, `TeamsRepository`, and `StandardsService`.
- `src/main/adapters/` implements ports. Pi SDK imports are confined to `src/main/adapters/pi/`.
- `src/main/application/` orchestrates runs through ports.
- `src/main/ipc/` handles Electron IPC and emits transport events.
- `src/main/store/` contains SQLite implementations behind adapters.

## Renderer

The renderer is React 19 + Zustand + Tailwind. It does not consume vendor runtime objects. It receives `AgentTransportEvent` over IPC and reduces those into `UIMessage` state for transcript rendering.

## IPC

`src/shared/types/ipc.ts` is the single contract for invoke/send/event channels. Runtime streaming uses OpenWaggle-owned `AgentTransportEvent`.

Session-tree and branch navigation use typed IPC channels such as `sessions:get-workspace`, `sessions:navigate-tree`, `sessions:rename-branch`, `sessions:archive-branch`, `sessions:restore-branch`, `sessions:update-tree-ui-state`, `pi-settings:get-tree-filter-mode`, `pi-settings:set-tree-filter-mode`, and `pi-settings:get-branch-summary-skip-prompt`.

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

Pi's resource loader is the runtime source of truth for skills and context files. OpenWaggle injects project resource roots in `.openwaggle > .pi > .agents` order for skills, extensions, prompts, and themes, then strips those implicit roots when Pi persists project settings. OpenWaggle catalog toggles apply to `.openwaggle/skills` and root `.agents/skills`; Pi-native discovery still governs Pi-owned/global resources.

## Security

Electron security remains fail-closed: no renderer Node integration, context isolation on, sandbox on, strict CSP, and IPC through the preload bridge only.
