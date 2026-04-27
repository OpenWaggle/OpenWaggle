# Hexagonal Architecture

This document defines the hexagonal architecture of the OpenWaggle main process. It is both descriptive (how the system exists) and prescriptive (how new code must be written).

---

## Layers

### Domain (`src/main/domain/`, `src/shared/domain/`)

Pure business logic. Zero infrastructure imports. Zero vendor imports. Zero side effects.

**Current modules:**
- `shared/domain/error-classifier.ts` — Error classification rules
- `shared/domain/skill-references.ts` — Skill reference parsing

**Rules:**
- MUST NOT import from Pi SDK, `electron`, `node:fs`, `node:child_process`, `@effect/sql`
- MUST NOT import from `src/main/store/`
- MAY import from `effect` (it is the language, not infrastructure)
- MAY import from `src/shared/types/`, `src/shared/constants/`

### Ports (`src/main/ports/`)

Effect `Context.Tag` service definitions. Interfaces that the domain and application layers depend on. Implemented by adapters.

**Current ports:**
- `AgentKernelService` — Pi-backed agent runtime
- `SessionRepository` — Session tree persistence
- `SessionProjectionRepository` — Conversation-shaped UI read model over session tables
- `ProviderService` — OpenWaggle-owned provider/model summaries backed by Pi metadata
- `StandardsService` — Agent/skill loading
- `TeamsRepository` — Team preset persistence

**Rules:**
- MUST NOT import from Pi SDK or any vendor SDK
- MUST NOT import from `src/main/store/` or any infrastructure
- Service methods MUST return `Effect.Effect<Result, TaggedError>`
- Every port MUST have at least one `yield*` consumer in production code

Known current gap: `StandardsService` is registered in the runtime but is not consumed by the standard Pi run path. Fixing that should either wire standards into Pi-native resources or remove the unused port.

### Adapters (`src/main/adapters/`)

`Layer` implementations that satisfy port contracts. The ONLY place vendor SDKs are imported.

**Current adapters:**
- `pi/pi-agent-kernel-adapter.ts` — Implements AgentKernelService via Pi SDK
- `sqlite-session-projection-repository.ts` — Implements SessionProjectionRepository via SQLite store
- `sqlite-session-repository.ts` — Implements SessionRepository via SQLite store
- `sqlite-teams-repository.ts` — Implements TeamsRepository via SQLite store
- `standards-adapter.ts` — Implements StandardsService via filesystem
- `pi/pi-provider-service.ts` — Implements ProviderService via Pi provider/model metadata

**Rules:**
- MAY import vendor SDKs only in the adapter slice that owns that vendor
- MUST implement a port from `src/main/ports/`
- MUST NOT be imported by domain or agent core
- MUST use runtime type guards (not casts) at type boundaries

### Application Services (`src/main/application/`)

Effect.gen programs that orchestrate business logic using ports via `yield*`. Called by IPC handlers.

**Current services:**
- `agent-run-service.ts` — Agent message execution coordination
- `waggle-run-service.ts` — Multi-agent waggle execution coordination
- `provider-test-service.ts` — Provider credential testing

**Rules:**
- MUST use `yield*` to consume ports (SessionProjectionRepository, ProviderService, etc.)
- MUST NOT import from Pi SDK or vendor SDKs
- MUST NOT import from `src/main/store/` directly
- MUST NOT contain IPC/transport concerns (event emission, stream buffers, abort controllers)

### Transport (`src/main/ipc/`)

IPC handlers. Thin dispatch + transport coordination (abort controllers, stream buffers, active run tracking, IPC event emission).

**Rules:**
- MUST delegate business logic to application services
- MUST NOT import from `src/main/store/` directly — use ports via `yield*`
- MUST NOT import from Pi SDK or vendor SDKs
- MAY import from `src/main/utils/stream-bridge.ts` (IPC emission is transport)
- Handler business logic should be minimal — most logic belongs in application services

### Infrastructure (`src/main/store/`)

Persistence modules that implement the actual I/O behind ports/adapters. Provider/model/auth runtime metadata comes from Pi through `src/main/adapters/pi/`.

**Rules:**
- Encapsulated behind adapter Layer implementations
- Not imported directly by IPC handlers, agent core, or application services
- The `store/` module is accessed only through SessionProjectionRepository, SettingsService, TeamsRepository adapters

---

## Domain Types (`src/shared/types/`)

Shared types that cross the IPC boundary. Zero vendor imports.

**Key domain types:**
- `stream.ts` — `AgentTransportEvent` (OpenWaggle-owned Pi-aligned transport)
- `ipc.ts` — IPC channel maps using domain types
- `agent.ts` — `AgentSendPayload` and vendor-free message parts

---

## Effect Runtime

All ports are `Context.Tag` services. All adapters are `Layer` implementations. The `AppLayer` in `src/main/runtime.ts` composes all layers.

```typescript
const AppLayer = Layer.mergeAll(
  NodeContext.layer,
  AppLogger.Live,
  AppDatabaseLive,
  SettingsService.Live,
  SqliteSessionProjectionRepositoryLive,
  FilesystemStandardsLive,
  PiAgentKernelLive,
  ProviderServiceLive,
  SqliteTeamsRepositoryLive,
)
```

IPC handlers run via `typedHandle` → `runAppEffectExit` → resolves all layers.

---

## CI Enforcement

`scripts/check-architecture.ts` enforces 8 rules on every PR:
1. No Pi SDK in `agent/`
2. No Pi SDK in `shared/`
3. No Pi SDK in `application/`
4. No Pi SDK in `ports/`
5. No direct store imports in `ipc/`
6. No Pi SDK/provider runtime imports outside `src/main/adapters/pi/`
7. No infrastructure imports in `domain/`
8. No direct store imports in `application/`

Run: `pnpm check:architecture`

---

## Adding New Features

### New port
1. Create `src/main/ports/my-service.ts` with `Context.Tag` + shape interface
2. Create `src/main/adapters/my-service-live.ts` implementing the port
3. Register the Live layer in `src/main/runtime.ts` AppLayer
4. Consume via `yield* MyService` in application services or handlers

### New application service
1. Create `src/main/application/my-service.ts`
2. Use `Effect.gen(function* () { const repo = yield* SomePort; ... })`
3. Import and call from the IPC handler

### New domain logic
1. Create in `src/main/domain/` or `src/shared/domain/`
2. Zero imports from infrastructure
3. Pure functions only

### New IPC handler
1. Create handler in `src/main/ipc/`
2. Delegate business logic to application service
3. Keep only transport concerns (abort, stream buffer, IPC emission)
4. Use `yield*` for any persistence or provider access
