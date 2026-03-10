---
title: "Architecture"
description: "OpenWaggle's Electron architecture — process boundaries, IPC type system, provider registry, agent loop, and tool system."
order: 1
section: "Developer Guide"
---

OpenWaggle is an Electron desktop app with three process targets sharing types through `src/shared/`.

```
src/
  main/              # Node.js process
  preload/           # Context bridge
  renderer/src/      # React 19 SPA
  shared/            # Shared types, schemas, utilities
```

## Process Boundaries

### Main Process (`src/main/`)

The Node.js backend. Handles:
- **Agent loop** — AI model interaction via TanStack AI adapters.
- **Tool execution** — File operations, shell commands, web fetch.
- **Persistence** — SQLite-backed app state plus project-local TOML config/trust files.
- **IPC handlers** — All renderer requests pass through here.
- **MCP management** — External tool server connections.
- **Auth** — OAuth flows and token management.

The main process is composed through Effect layers and runs through a shared managed runtime.

Built as CJS with ESM interop (electron-vite bundles ESM-only packages).

### Preload (`src/preload/`)

The bridge between main and renderer. Exposes a typed `window.api` object via Electron's `contextBridge`. Every renderer-to-main interaction goes through this API. The preload script maps friendly method names to IPC channels.

### Renderer (`src/renderer/src/`)

The React 19 UI. Key technologies:
- **React 19** with React Compiler (auto-memoization, no manual `React.memo()`).
- **Zustand** for state management (multiple focused stores).
- **Tailwind CSS v4** for styling.
- **xterm.js** for the terminal emulator.

## IPC Type System

`src/shared/types/ipc.ts` is the single source of truth for all inter-process communication:

| Channel Map | Direction | Pattern |
|------------|-----------|---------|
| `IpcInvokeChannelMap` | Renderer to Main | Request/response |
| `IpcSendChannelMap` | Renderer to Main | Fire-and-forget |
| `IpcEventChannelMap` | Main to Renderer | Push events |

## Provider Registry

`src/main/providers/` implements a dynamic multi-provider system:

- `ProviderDefinition` interface defines each provider's capabilities.
- `ProviderRegistry` singleton manages registration and model-to-provider resolution.
- `registerAllProviders()` runs at startup.
- Each provider exports a model list, adapter factory, and capability flags.

## Agent Loop

`src/main/agent/agent-loop.ts` uses TanStack AI's `chat()` with Effect-owned control flow:

1. Converts `Message[]` to `SimpleChatMessage[]`.
2. Resolves provider via the registry.
3. Binds run-scoped `ToolContext` into the selected tools.
4. Processes the stream with Effect-based stall detection, retry scheduling, and cancellation.
5. Emits events over IPC to all renderer windows.
6. Tools execute inline — results arrive via `TOOL_CALL_END`.

## Tool System

Tools are defined in `src/main/tools/tools/` using `defineOpenWaggleTool()`:

- Each tool has an Effect Schema input contract for argument validation.
- `ToolContext` (project path, abort signal, dynamic skills) is bound explicitly per run.
- Path resolution prevents escaping the project root.
- Results are structured as `{ kind: 'text' | 'json' }`.

## Feature System

Agent capabilities are composed via `AgentFeature` interface:

```
Feature -> {
  getPromptFragments()   // System prompt additions
  getTools()             // Tool contributions
  filterTools()          // Tool filtering (e.g., default-permissions/full-access policy)
  getLifecycleHooks()    // Run lifecycle callbacks
}
```

Default features: core prompt, core tools, execution mode, standards/skills, MCP tools, observability.

## Orchestration Engine

`src/main/orchestration/` implements multi-step task execution:

- **Planner** — LLM generates a task graph (JSON) with dependencies.
- **Executor** — Runs tasks in dependency order.
- **Fallback handling** — Orchestration flows can degrade gracefully when planning/execution fails.
- **Persistence** — Uses an append-only event store plus read-model tables in SQLite.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 40 + electron-vite |
| Renderer | React 19, Zustand 5, Tailwind CSS 4 |
| AI Integration | TanStack AI 0.6.x |
| Language | TypeScript (strict, no `any`) |
| Main Runtime | Effect |
| Validation | Effect Schema |
| Bundler | Vite + Rollup |
| Linter/Formatter | Biome |
| Testing | Vitest + Testing Library + Playwright |
| Terminal | xterm.js + node-pty |
| Storage | SQLite + project-local TOML |
| MCP | @modelcontextprotocol/sdk |
