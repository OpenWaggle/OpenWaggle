# Developer Guide

This guide covers building, developing, and understanding OpenWaggle's architecture.

## Prerequisites

- **Node.js** 20+ — [nodejs.org](https://nodejs.org/)
- **pnpm** 9+ — [pnpm.io](https://pnpm.io/)

## Building from Source

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd openwaggle
pnpm install
```

### Development Mode

```bash
pnpm dev
```

This launches the Electron app with:
- **Hot-reload** for the renderer (React UI updates live).
- **No hot-reload** for the main process — restart the app for backend changes.

### Production Build

```bash
pnpm build
```

### Platform Installers

```bash
pnpm build:mac    # macOS .dmg (x64 + arm64)
pnpm build:win    # Windows NSIS installer (x64)
pnpm build:linux  # Linux AppImage (x64)
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start in development mode |
| `pnpm build` | Production build |
| `pnpm typecheck` | Full type check (main + renderer) |
| `pnpm typecheck:node` | Type check main + preload + shared |
| `pnpm typecheck:web` | Type check renderer + shared |
| `pnpm lint` | Biome lint check |
| `pnpm lint:fix` | Biome lint + auto-fix |
| `pnpm format` | Biome format |
| `pnpm check` | typecheck + lint combined |
| `pnpm test` | All tests (unit + integration + component) |
| `pnpm test:all` | All tests including headless e2e |
| `pnpm test:unit` | Unit tests only (`*.unit.test.ts`) |
| `pnpm test:integration` | Integration tests only (`*.integration.test.ts`) |
| `pnpm test:component` | Component tests only (`*.component.test.tsx`) |
| `pnpm test:e2e` | Playwright E2E tests (headless, requires `pnpm build` first) |
| `pnpm test:coverage` | Coverage report (v8 provider) |
| `pnpm prepush:main` | Quality gate used by the pre-push hook when pushing `main` |

## Git Hooks

Husky manages a `pre-push` hook that runs only when the push includes `refs/heads/main`.

The hook runs:

- `pnpm check`
- `pnpm format`
- `pnpm test:all`

## Architecture

OpenWaggle is an Electron desktop app with three process targets sharing types through `src/shared/`.

```
src/
  main/              # Node.js process
  preload/           # Context bridge
  renderer/src/      # React 19 SPA
  shared/            # Shared types, schemas, utilities
```

### Process Boundaries

#### Main Process (`src/main/`)

The Node.js backend. Handles:
- **Agent loop** — AI model interaction via TanStack AI adapters.
- **Tool execution** — File operations, shell commands, web fetch.
- **Persistence** — Conversation files, settings, orchestration runs.
- **IPC handlers** — All renderer requests pass through here.
- **MCP management** — External tool server connections.
- **Auth** — OAuth flows and token management.

Built as CJS with ESM interop (electron-vite bundles ESM-only packages).

#### Preload (`src/preload/`)

The bridge between main and renderer. Exposes a typed `window.api` object via Electron's `contextBridge`. Every renderer-to-main interaction goes through this API. The preload script maps friendly method names to IPC channels.

#### Renderer (`src/renderer/src/`)

The React 19 UI. Key technologies:
- **React 19** with React Compiler (auto-memoization, no manual `React.memo()`).
- **Zustand** for state management (multiple focused stores).
- **Tailwind CSS v4** for styling.
- **xterm.js** for the terminal emulator.

### IPC Type System

`src/shared/types/ipc.ts` is the single source of truth for all inter-process communication:

| Channel Map | Direction | Pattern |
|------------|-----------|---------|
| `IpcInvokeChannelMap` | Renderer to Main | Request/response |
| `IpcSendChannelMap` | Renderer to Main | Fire-and-forget |
| `IpcEventChannelMap` | Main to Renderer | Push events |

### Provider Registry

`src/main/providers/` implements a dynamic multi-provider system:

- `ProviderDefinition` interface defines each provider's capabilities.
- `ProviderRegistry` singleton manages registration and model-to-provider resolution.
- `registerAllProviders()` runs at startup.
- Each provider exports a model list, adapter factory, and capability flags.

### Agent Loop

`src/main/agent/agent-loop.ts` uses TanStack AI's `chat()`:

1. Converts `Message[]` to `SimpleChatMessage[]`.
2. Resolves provider via the registry.
3. Iterates the async stream, translating events to `AgentStreamEvent`.
4. Emits events over IPC to all renderer windows.
5. Tools execute inline — results arrive via `TOOL_CALL_END`.

### Tool System

Tools are defined in `src/main/tools/tools/` using `defineOpenWaggleTool()`:

- Each tool has a Zod schema for argument validation.
- `ToolContext` (project path, abort signal, dynamic skills) is available via async local storage.
- Path resolution prevents escaping the project root.
- Results are structured as `{ kind: 'text' | 'json' }`.

### Feature System

Agent capabilities are composed via `AgentFeature` interface:

```
Feature → {
  getPromptFragments()   // System prompt additions
  getTools()             // Tool contributions
  filterTools()          // Tool filtering (e.g., default-permissions/full-access policy)
  getLifecycleHooks()    // Run lifecycle callbacks
}
```

Default features: core prompt, core tools, execution mode, standards/skills, MCP tools, observability.

### Orchestration Engine

`src/main/orchestration/` implements multi-step task execution:

- **Planner** — LLM generates a task graph (JSON) with dependencies.
- **Executor** — Runs tasks in dependency order.
- **Fallback handling** — Orchestration flows can degrade gracefully when planning/execution fails.
- **Run store** — Persists run state separately from conversations.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 40 + electron-vite |
| Renderer | React 19, Zustand 5, Tailwind CSS 4 |
| AI Integration | TanStack AI 0.6.x |
| Language | TypeScript (strict, no `any`) |
| Validation | Zod v4 |
| Bundler | Vite + Rollup |
| Linter/Formatter | Biome |
| Testing | Vitest + Testing Library + Playwright |
| Terminal | xterm.js + node-pty |
| Storage | electron-store |
| MCP | @modelcontextprotocol/sdk |

## Key Conventions

- **Always use `pnpm`** — Never `npm` or `yarn`.
- **No `any`** — Use `unknown` plus narrowing or Zod schemas.
- **No `React.FC`** — Plain functions with explicit props interfaces.
- **No `forwardRef`** — React 19 supports direct ref props.
- **No `React.memo()` / `useMemo()` / `useCallback()`** for render optimization — React Compiler handles it.
- **No `process.env`** — Import from `./env` modules.
- **No raw `console.*` in main process** — Use the structured logger from `src/main/logger.ts`.
- **Zustand selectors** — Always use `useStore((s) => s.field)`, never call stores without a selector.
- **`cn()`** — Use the utility from `src/lib/utils` for conditional Tailwind classes.

## Path Aliases

| Alias | Maps To | Available In |
|-------|---------|-------------|
| `@shared/*` | `src/shared/*` | All targets |
| `@/*` | `src/renderer/src/*` | Renderer only |

## Testing

### Test File Naming

- `*.unit.test.ts` — Unit tests (isolated, no external dependencies).
- `*.integration.test.ts` — Integration tests (may touch file system, IPC).
- `*.component.test.tsx` — React component tests (JSDOM + Testing Library).

### Running Tests

```bash
pnpm test             # All tests
pnpm test:all         # All tests including headless E2E
pnpm test:unit        # Unit tests only
pnpm test:integration # Integration tests only
pnpm test:component   # Component tests only
pnpm test:e2e         # Playwright E2E (headless, requires build)
pnpm test:coverage    # Coverage report
```

### E2E Testing

E2E tests use Playwright and require a production build first:

```bash
pnpm build
pnpm test:e2e
```

The `OPENWAGGLE_USER_DATA_DIR` env var can override the data directory for test isolation.

## Configuration Files

| File | Purpose |
|------|---------|
| `electron.vite.config.ts` | Build config (main/preload/renderer). ESM package bundling, React Compiler. |
| `electron-builder.yml` | Platform build config (dmg, NSIS, AppImage). |
| `tsconfig.json` | Root TypeScript config (references node + web). |
| `tsconfig.node.json` | Main + preload + shared TypeScript config. |
| `tsconfig.web.json` | Renderer + shared TypeScript config. |
| `biome.json` | Linter and formatter config. |
| `vitest.config.ts` | Test runner config. |
