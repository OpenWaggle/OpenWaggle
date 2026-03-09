# 59 — Effect-TS Adoption with Effect Schema Migration

**Status:** Complete
**Priority:** P1
**Category:** Architecture / Migration
**Completed On:** 2026-03-09
**Origin:** Architectural migration to make OpenWaggle's Electron main process Effect-native while moving app-owned persistence to SQLite and preserving the strongest OpenWaggle-specific product decisions.

---

## Goal

Bring OpenWaggle to a T3Code-level architecture for runtime composition, validation, and orchestration persistence without flattening the parts where OpenWaggle is already stronger:

- TanStack AI remains the chat and tool execution boundary.
- Typed Electron IPC remains the single inter-process contract.
- App-owned state moves to SQLite.
- Project-local trust and policy stay explicit in `.openwaggle/config.toml` and `.openwaggle/config.local.toml`.
- Electron security defaults remain fail-closed.

## Final Architecture

### Runtime

- The Electron main process now runs through a shared Effect runtime in [`src/main/runtime.ts`](../../src/main/runtime.ts).
- Live services are composed through Effect layers, including:
  - [`src/main/services/logger-service.ts`](../../src/main/services/logger-service.ts)
  - [`src/main/services/provider-registry-service.ts`](../../src/main/services/provider-registry-service.ts)
  - [`src/main/services/database-service.ts`](../../src/main/services/database-service.ts)
- IPC handlers bridge into Effect via [`src/main/ipc/typed-ipc.ts`](../../src/main/ipc/typed-ipc.ts) and `typedHandleEffect(...)`.

### Validation

- Effect Schema fully replaced Zod across shared and runtime boundaries.
- Shared helpers live in [`src/shared/schema.ts`](../../src/shared/schema.ts).
- Shared schemas live under [`src/shared/schemas/`](../../src/shared/schemas/).
- The old Zod dependency and migration skill were removed.

### Persistence

- SQLite is now the source of truth for app-owned state at `{userData}/openwaggle.db`.
- Database bootstrap, WAL setup, and migrations live in [`src/main/services/database-service.ts`](../../src/main/services/database-service.ts).
- SQLite now stores:
  - settings
  - auth tokens
  - conversations and message parts
  - orchestration events
  - orchestration run/task read models
  - team presets
  - team runtime state
- Project-local policy and trust remain file-backed in `.openwaggle/config.toml` and `.openwaggle/config.local.toml`.

### Agent Runtime

- The agent loop now uses Effect-owned control flow in [`src/main/agent/agent-loop.ts`](../../src/main/agent/agent-loop.ts).
- Stream control now uses Effect in [`src/main/agent/stream-processor.ts`](../../src/main/agent/stream-processor.ts) for:
  - stall detection
  - retry delay scheduling
  - cancellation propagation
  - lifecycle error handling
- TanStack `chat()` remains the imperative boundary for model execution and stream delivery.

### Tool Runtime

- `AsyncLocalStorage` was fully removed from the tool runtime.
- OpenWaggle tools are now bound to an explicit run-scoped `ToolContext` in [`src/main/tools/define-tool.ts`](../../src/main/tools/define-tool.ts).
- This keeps context explicit at the TanStack server-tool boundary and avoids hidden ambient runtime state.

## T3Code Alignment

### Adopted from T3Code

- Effect `Layer`-based runtime composition
- Effect-owned main/server runtime boundary
- Effect Schema for runtime validation
- SQLite-backed orchestration persistence
- append-only orchestration events plus read-model tables

### Intentionally Different

- TanStack AI stays the chat/tool execution engine instead of moving to a provider-native runtime.
- Electron typed IPC stays the first-class application contract instead of HTTP or RPC routes.
- Project trust and policy stay in `.openwaggle/config*.toml`.
- Tool context is explicitly bound per run instead of modeled as an ambient scoped service because that is the cleaner fit for TanStack server tools in this codebase.

## Work Completed

- [x] Added Effect runtime and composed live services.
- [x] Bundled Effect correctly in Electron main builds.
- [x] Replaced source-tree Zod usage with Effect Schema.
- [x] Added shared schema helpers and readable parse-issue formatting.
- [x] Migrated typed IPC to Effect-aware handler execution.
- [x] Moved app-owned persistence from JSON and `electron-store` to SQLite.
- [x] Added orchestration event-store plus read-model persistence.
- [x] Migrated the agent loop to Effect-owned retry, stall, and cancellation flow.
- [x] Removed `AsyncLocalStorage` tool context in favor of explicit run-scoped tool binding.
- [x] Removed dead migration leftovers and stale compatibility code.
- [x] Updated repository architecture documentation and developer docs.

## Dead-Code and Compatibility Cleanup

- Removed `zod` from dependencies.
- Removed `electron-store` from dependencies.
- Removed the obsolete `AsyncMutex` utility.
- Removed the old Zod migration skill and stale script references.
- Removed unused exports, stale helpers, and no-longer-reachable migration compatibility code uncovered during the migration sweep.

## Verification

The migration was verified with:

- `pnpm typecheck`
- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e:headless:quick`
- `npx -y react-doctor@latest . --verbose --diff main`

## Acceptance Result

All acceptance criteria for this migration are now satisfied:

- no Zod remains in the runtime codepath
- no `electron-store` remains for app-owned persistence
- no JSON-file conversation or orchestration persistence remains
- project config and trust remain file-backed
- TanStack chat and tool behavior remain intact
- Electron production builds boot with Effect and SQLite correctly bundled

## Documentation

- Architecture overview: [`docs/architecture.md`](../../docs/architecture.md)
- Developer guide: [`docs/user-guide/developer-guide.md`](../../docs/user-guide/developer-guide.md)
- Configuration guide: [`docs/user-guide/configuration.md`](../../docs/user-guide/configuration.md)
- Skills guide: [`docs/user-guide/skills.md`](../../docs/user-guide/skills.md)

## External References

- [T3Code server layers](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/serverLayers.ts)
- [T3Code base schemas](https://github.com/pingdotgg/t3code/blob/main/packages/contracts/src/baseSchemas.ts)
- [T3Code orchestration engine layer](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration/Layers/OrchestrationEngine.ts)
- [T3Code orchestration event store](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/persistence/Layers/OrchestrationEventStore.ts)
