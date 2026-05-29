# System Architecture

OpenWaggle is an Electron desktop agent with a Pi-native runtime core and a SQLite session projection.

## Main Process

The main process owns runtime execution, persistence, provider configuration, auth, and IPC.

Layering follows the hexagonal model:

- `src/main/domain/` contains pure business logic.
- `src/main/ports/` defines Effect service ports such as `AgentKernelService`, `SessionRepository`, `SessionProjectionRepository`, `SessionTreePreferencesService`, `ProviderService`, `ProviderAuthService`, `ProviderOAuthService`, `ProviderProbeService`, `WagglePresetsRepository`, and `StandardsService`.
- `src/main/adapters/` implements ports. OpenWaggle desktop app Pi SDK imports are confined to `src/main/adapters/pi/`; dedicated Pi packages under `packages/pi-*` may import Pi SDKs internally.
- `src/main/application/` orchestrates runs through ports.
- `src/main/ipc/` handles Electron IPC and emits transport events.
- `src/main/store/` contains SQLite implementations behind adapters.

## Renderer

The renderer is React 19 + TanStack Router/Query + Zustand + Tailwind. It does not consume vendor runtime objects. It receives `AgentTransportEvent` over IPC and reduces those into `UIMessage` state for transcript rendering.

Renderer organization is feature-first:

- `src/renderer/src/routes/` owns TanStack Router route files and route-only surfaces.
- `src/renderer/src/features/` owns product features, including components, hooks, state, constants, commands, model types, pure logic, and colocated tests.
- `src/renderer/src/shared/` owns reusable renderer primitives with no product-domain ownership.
- `src/renderer/src/shell/` owns app-frame composition around routes and features.

Detailed renderer rules live in `docs/renderer-architecture.md`.

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

## Waggle Presets

Waggle presets are resolved through `WagglePresetsRepository`. Built-in presets are bundled in the adapter, global presets are stored in Electron user data as `waggle-presets.json`, and project presets are stored in `.openwaggle/settings.json`. Project presets override global presets with the same id.

## Waggle

Waggle uses the same session projection as standard mode. The target architecture splits portable policy into `@openwaggle/waggle-core` and Pi-specific execution into `@openwaggle/pi-waggle`; see `docs/adr/0004-split-portable-waggle-core-from-pi-adapter.md`. Runtime mode state and turn attribution should come from Pi session entries/messages and be projected into OpenWaggle metadata, not encoded as synthetic transcript tool calls.

## Providers

Pi is the source of truth for provider, model, and auth metadata. The Pi adapter exposes that metadata through OpenWaggle-owned ports and IPC DTOs so renderer code can curate the model picker.

## Standards And Skills

Pi's resource loader is the runtime source of truth for skills and context files. OpenWaggle injects project resource roots in `.openwaggle > .pi > .agents` order for skills, extensions, prompts, and themes, then strips those implicit roots when Pi persists project settings. OpenWaggle catalog toggles apply to `.openwaggle/skills` and root `.agents/skills`; Pi-native discovery still governs Pi-owned/global resources.

## MCP

MCP support is provided through Pi's extension system using the `pi-mcp-adapter` package source. The main process owns MCP config file reads/writes behind `McpConfigService`; the renderer only sees typed IPC DTOs. The effective MCP config merges global standard, global Pi, project standard, `.agents`, project Pi, and `.openwaggle/agent/mcp.json` sources before being passed to Pi for the next run. The Pi adapter scopes adapter startup and session binding to the generated MCP config and an isolated adapter cwd, then emits `session_shutdown` before disposal so MCP server state follows Pi's extension lifecycle.

## Security

Electron security remains fail-closed: no renderer Node integration, context isolation on, sandbox on, strict CSP, and IPC through the preload bridge only.
