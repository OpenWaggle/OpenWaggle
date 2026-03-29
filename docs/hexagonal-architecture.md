# Hexagonal Architecture

This document defines the hexagonal architecture of the OpenWaggle main process. It is both descriptive (how the system exists) and prescriptive (how new code must be written).

---

## Layers

### Domain (`src/main/domain/`, `src/shared/domain/`)

Pure business logic. Zero infrastructure imports. Zero vendor imports. Zero side effects.

**Current modules:**
- `domain/quality/quality-resolver.ts` — Quality preset resolution
- `domain/trust/trust-pattern-matcher.ts` — Tool trust pattern matching
- `shared/domain/error-classifier.ts` — Error classification rules
- `shared/domain/skill-references.ts` — Skill reference parsing
- `shared/domain/trust-pattern-derivation.ts` — Trust pattern generation

**Rules:**
- MUST NOT import from `@tanstack/ai`, `electron`, `node:fs`, `node:child_process`, `@effect/sql`
- MUST NOT import from `src/main/store/`, `src/main/providers/`, `src/main/mcp/`
- MAY import from `effect` (it is the language, not infrastructure)
- MAY import from `src/shared/types/`, `src/shared/constants/`

### Ports (`src/main/ports/`)

Effect `Context.Tag` service definitions. Interfaces that the domain and application layers depend on. Implemented by adapters.

**Current ports:**
- `ChatService` — LLM streaming
- `ConversationRepository` — Conversation persistence
- `ProviderService` — Provider resolution + adapter creation
- `StandardsService` — Agent/skill loading
- `TeamsRepository` — Team preset persistence

**Rules:**
- MUST NOT import from `@tanstack/ai` or any vendor SDK
- MUST NOT import from `src/main/store/` or any infrastructure
- Service methods MUST return `Effect.Effect<Result, TaggedError>`
- Every port MUST have at least one `yield*` consumer in production code

### Adapters (`src/main/adapters/`)

`Layer` implementations that satisfy port contracts. The ONLY place vendor SDKs are imported.

**Current adapters:**
- `tanstack-chat-adapter.ts` — Implements ChatService via TanStack AI `chat()`
- `stream-chunk-mapper.ts` — Bidirectional AgentStreamChunk ↔ StreamChunk
- `continuation-mapper.ts` — DomainContinuationMessage ↔ vendor ModelMessage
- `sqlite-conversation-repository.ts` — Implements ConversationRepository via SQLite store
- `sqlite-teams-repository.ts` — Implements TeamsRepository via SQLite store
- `standards-adapter.ts` — Implements StandardsService via filesystem
- `provider-service-live.ts` — Implements ProviderService via provider registry

**Rules:**
- MAY import from `@tanstack/ai` and vendor SDKs (this is their job)
- MUST implement a port from `src/main/ports/`
- MUST NOT be imported by domain or agent core
- MUST use runtime type guards (not casts) at type boundaries

### Application Services (`src/main/application/`)

Effect.gen programs that orchestrate business logic using ports via `yield*`. Called by IPC handlers.

**Current services:**
- `agent-run-service.ts` — Agent message execution orchestration
- `waggle-run-service.ts` — Multi-agent waggle execution orchestration
- `provider-test-service.ts` — Provider credential testing

**Rules:**
- MUST use `yield*` to consume ports (ConversationRepository, ProviderService, etc.)
- MUST NOT import from `@tanstack/ai` or vendor SDKs
- MUST NOT import from `src/main/store/` directly
- MUST NOT contain IPC/transport concerns (event emission, stream buffers, abort controllers)

### Transport (`src/main/ipc/`)

IPC handlers. Thin dispatch + transport coordination (abort controllers, stream buffers, active run tracking, IPC event emission).

**Rules:**
- MUST delegate business logic to application services
- MUST NOT import from `src/main/store/` directly — use ports via `yield*`
- MUST NOT import from `@tanstack/ai` or vendor SDKs
- MAY import from `src/main/utils/stream-bridge.ts` (IPC emission is transport)
- Handler business logic should be minimal — most logic belongs in application services

### Infrastructure (`src/main/store/`, `src/main/providers/`, `src/main/mcp/`, `src/main/orchestration/`, `src/main/tools/`)

Persistence, vendor SDK wrappers, protocol bridges, tool factories. These modules implement the actual I/O.

**Rules:**
- Encapsulated behind adapter Layer implementations
- Not imported directly by IPC handlers, agent core, or application services
- The `store/` module is accessed only through ConversationRepository, SettingsService, TeamsRepository adapters

---

## Domain Types (`src/shared/types/`)

Shared types that cross the IPC boundary. Zero vendor imports.

**Key domain types:**
- `stream.ts` — `AgentStreamChunk` (replaces vendor `StreamChunk`)
- `continuation.ts` — `DomainContinuationMessage` (replaces vendor `ModelMessage`/`UIMessage`)
- `ipc.ts` — IPC channel maps using domain types
- `agent.ts` — `AgentSendPayload` using domain continuation types

---

## Effect Runtime

All ports are `Context.Tag` services. All adapters are `Layer` implementations. The `AppLayer` in `src/main/runtime.ts` composes all layers.

```typescript
const AppLayer = Layer.mergeAll(
  NodeContext.layer,
  AppLogger.Live,
  ProviderRegistryService.Live,
  AppDatabaseLive,
  SettingsService.Live,
  SqliteConversationRepositoryLive,
  FilesystemStandardsLive,
  TanStackChatLive,
  ProviderServiceLive,
  SqliteTeamsRepositoryLive,
)
```

IPC handlers run via `typedHandle` → `runAppEffectExit` → resolves all layers.

---

## CI Enforcement

`scripts/check-architecture.ts` enforces 8 rules on every PR:
1. No `@tanstack/ai` in `agent/`
2. No `@tanstack/ai` in `shared/` (except `.d.ts`)
3. No `@tanstack/ai` in `application/`
4. No `@tanstack/ai` in `ports/`
5. No direct store imports in `ipc/`
6. No `providerRegistry` outside `adapters/`, `providers/`, `services/`, `store/`
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
