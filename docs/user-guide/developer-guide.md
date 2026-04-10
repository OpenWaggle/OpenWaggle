# Developer Guide

This guide covers building, developing, and understanding OpenWaggle's architecture.

OpenWaggle's main process is now Effect-native. For the up-to-date runtime map, see [Architecture](../architecture.md).

## Prerequisites

- **Node.js** 24.x — [nodejs.org](https://nodejs.org/)
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
- **Electron-native rebuild prep** for native dependencies such as `better-sqlite3`.

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

These scripts prove the packaging pipeline locally, but they are not a full end-user release workflow yet:

- `build:mac` currently produces unsigned local DMGs because `electron-builder.yml` sets `mac.identity: null`
- `build:win` and `build:linux` produce local artifacts, but there is no release workflow, checksum publication, or installer smoke coverage yet

If you are preparing public downloads, use [GitHub Issue #49](https://github.com/OpenWaggle/OpenWaggle/issues/49) as the release-readiness checklist rather than treating `pnpm build:*` as sufficient.

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start in development mode |
| `pnpm build` | Production build |
| `pnpm prepare:native:node` | Rebuild native dependencies for Node-based test runs |
| `pnpm prepare:native:electron` | Rebuild native dependencies for Electron dev/build/e2e runs |
| `pnpm typecheck` | Full type check (main + renderer) |
| `pnpm typecheck:node` | Type check main + preload + shared |
| `pnpm typecheck:web` | Type check renderer + shared |
| `pnpm lint` | Biome lint check |
| `pnpm lint:fix` | Biome lint + auto-fix |
| `pnpm format` | Biome format |
| `pnpm check:fast` | Typecheck + lint only |
| `pnpm check` | typecheck + lint combined |
| `pnpm test` | All tests (unit + integration + component) |
| `pnpm test:all` | All tests including headless e2e |
| `pnpm test:unit` | Unit tests only (`*.unit.test.ts`) |
| `pnpm test:integration` | Integration tests only (`*.integration.test.ts`) |
| `pnpm test:component` | Component tests only (`*.component.test.tsx`) |
| `pnpm test:e2e` | Playwright E2E tests (headless, requires `pnpm build` first) |
| `pnpm test:coverage` | Coverage report (v8 provider) |
| `pnpm prepush:main` | Quality gate used by the pre-push hook when pushing `main` |

## Shipping To Users

OpenWaggle already has the initial desktop artifact matrix:

- macOS `dmg` for `x64` and `arm64`
- Windows `nsis` for `x64`
- Linux `AppImage` for `x64`

That is enough to verify packaging during development, but not enough to claim supported public installers. Before publishing end-user downloads we still need:

- macOS Developer ID signing, notarization, and stapling
- Windows code signing
- GitHub Actions release automation for all supported platforms
- Published checksums and release notes
- Clean-machine installer validation on each platform

OpenClaw is a useful reference for release discipline here:

- it has explicit install entrypoints
- it runs installer smoke tests in CI
- it has a documented release checklist
- it has a dedicated macOS packaging/signing/notarization flow

OpenClaw is not a full desktop-platform template for OpenWaggle, though. Its native desktop release path is strongest on macOS; OpenWaggle still has to own native Windows and Linux desktop distribution itself.

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
- **Persistence** — SQLite-backed app state plus project-local TOML config/trust files.
- **IPC handlers** — All renderer requests pass through here.
- **MCP management** — External tool server connections.
- **Auth** — OAuth flows and token management.

The main process is composed through Effect layers and runs through a shared managed runtime.

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

`src/main/agent/agent-loop.ts` uses TanStack AI's `chat()` with Effect-owned control flow:

1. Converts `Message[]` to `SimpleChatMessage[]`.
2. Resolves provider via the registry.
3. Binds run-scoped `ToolContext` into the selected tools.
4. Processes the stream with Effect-based stall detection, retry scheduling, and cancellation.
5. Emits events over IPC to all renderer windows.
6. Tools execute inline — results arrive via `TOOL_CALL_END`.

### Tool System

Tools are defined in `src/main/tools/tools/` using `defineOpenWaggleTool()`:

- Each tool has an Effect Schema input contract for argument validation.
- `ToolContext` (project path, abort signal, dynamic skills) is bound explicitly per run.
- Path resolution supports both relative (project-rooted) and absolute paths.
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

## Key Conventions

- **Always use `pnpm`** — Never `npm` or `yarn`.
- **No `any`** — Use `unknown` plus narrowing or Effect Schema.
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

## Inspecting the SQLite Database

OpenWaggle stores app-owned runtime state in a single SQLite database named `openwaggle.db`.

The database path is computed from Electron's `app.getPath('userData')` in [`src/main/services/database-service.ts`](../../src/main/services/database-service.ts). If `OPENWAGGLE_USER_DATA_DIR` is set before launch, the database is created inside that override directory instead.

### Default Database Locations

| Platform | Location |
|------|---------|
| macOS | `~/Library/Application Support/OpenWaggle/openwaggle.db` |
| Windows | `%APPDATA%\OpenWaggle\openwaggle.db` |
| Linux | `~/.config/OpenWaggle/openwaggle.db` |

Because OpenWaggle runs SQLite in WAL mode, you may also see companion files next to the main database:

- `openwaggle.db-wal`
- `openwaggle.db-shm`

Those are expected.

### Recommended Access Pattern

For manual inspection, prefer opening the database read-only:

```bash
sqlite3 "~/Library/Application Support/OpenWaggle/openwaggle.db" -readonly
```

Inside the SQLite shell:

```sql
.tables
.schema conversations
SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 20;
SELECT key, value_json FROM settings_store ORDER BY key;
SELECT provider, updated_at FROM auth_tokens ORDER BY provider;
SELECT run_id, status, updated_at FROM orchestration_runs ORDER BY updated_at DESC LIMIT 20;
```

If you prefer a GUI, DB Browser for SQLite or TablePlus work fine against the same file.

### Working With a Custom Data Directory

If you launch OpenWaggle with a custom data directory:

```bash
OPENWAGGLE_USER_DATA_DIR=/tmp/openwaggle-dev pnpm dev
```

the database will be created at:

```bash
/tmp/openwaggle-dev/openwaggle.db
```

That is the easiest way to inspect or reset a clean development dataset without touching your normal local app state.

### Common Queries

Recent conversations:

```sql
SELECT id, title, model, project_path, archived, updated_at
FROM conversations
ORDER BY updated_at DESC
LIMIT 20;
```

Messages for one conversation:

```sql
SELECT id, role, model, created_at, position
FROM conversation_messages
WHERE conversation_id = 'your-conversation-id'
ORDER BY position ASC;
```

Message parts for one message:

```sql
SELECT message_id, part_type, content_json, position
FROM conversation_message_parts
WHERE message_id = 'your-message-id'
ORDER BY position ASC;
```

Recent orchestration events:

```sql
SELECT sequence, stream_id, event_type, occurred_at
FROM orchestration_events
ORDER BY sequence DESC
LIMIT 50;
```

Team runtime state:

```sql
SELECT project_path, team_name, updated_at
FROM team_runtime_state
ORDER BY updated_at DESC;
```

### Table Map

The main tables created by the current migration set are:

- `_migrations` — applied schema migrations
- `settings_store` — app settings
- `auth_tokens` — encrypted provider and OAuth token payloads
- `team_presets` — saved Waggle team presets
- `conversations` — conversation summaries
- `conversation_messages` — message rows per conversation
- `conversation_message_parts` — normalized message parts
- `orchestration_events` — append-only orchestration event store
- `orchestration_runs` — orchestration read model
- `orchestration_run_tasks` — task read model for orchestration runs
- `provider_session_runtime` — provider runtime session state
- `team_runtime_state` — team runtime/project state

### Safety Notes

- Read-only inspection is safest while the app is running.
- If you want to modify or delete data manually, close OpenWaggle first.
- `auth_tokens.encrypted_value` is intentionally encrypted at rest, so raw token rows are not meant to be human-readable.

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
