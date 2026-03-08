# 59 — Effect-TS Adoption with Effect Schema Migration

**Status:** Not Started
**Priority:** P1
**Category:** Architecture / Migration
**Depends on:** None (but informs Spec 56 SQLite persistence approach)
**Origin:** Architectural decision — adopt Effect-TS as the core runtime for the main process, replacing ad-hoc async patterns with structured Effect composition, and migrating Zod v4 schemas to Effect Schema for unified runtime validation.

---

## Problem

OpenWaggle's main process uses standard TypeScript patterns for async orchestration, error handling, and dependency injection:

- **Async:** `async/await` with try/catch, manual `AbortController` wiring, `AsyncMutex` for concurrency
- **Error handling:** Thrown `Error` instances with untyped catch blocks, no error channel tracking
- **DI:** `AsyncLocalStorage` for `ToolContext`, singleton patterns for `ProviderRegistry`, module-level state
- **Validation:** Zod v4 schemas (88+ schemas across 66 files) with `.safeParse()` / `.parse()`
- **Resource management:** Manual cleanup in `finally` blocks, no structured lifecycle

These patterns work but have limitations at scale:
1. **Untyped errors** — `catch (err)` loses type information; callers don't know what can fail
2. **Fragile concurrency** — Manual mutex/abort wiring is error-prone
3. **Scattered DI** — `AsyncLocalStorage`, singletons, and module-level state make testing harder
4. **Two validation worlds** — If we adopt Effect for runtime/services, keeping Zod creates a split brain

Effect-TS provides:
- **Typed error channels** — `Effect<Success, Error, Requirements>` tracks errors in the type system
- **Structured concurrency** — Fibers with automatic interruption propagation
- **Service layers** — `Context.Tag` + `Layer` for composable, testable DI
- **Effect Schema** — Bidirectional encode/decode with Standard Schema interop
- **Resource management** — `Effect.acquireRelease` for deterministic cleanup

### Why Now

Several upcoming specs (56-SQLite, 55-Checkpoint) involve major persistence and orchestration rewrites. Adopting Effect before those implementations avoids doing them twice. The `@effect/sql-sqlite-node` package provides a ready-made SQLite integration that aligns perfectly with Spec 56.

### TanStack AI Compatibility

TanStack AI's `toolDefinition().inputSchema` accepts Standard Schema compliant libraries. Effect Schema supports `Schema.standardSchemaV1()`, making it compatible with TanStack AI tool definitions. No Zod shim is needed for tools.

Sources: [TanStack AI Tools Docs](https://tanstack.com/ai/latest/docs/guides/tools), [TanStack AI ToolDefinition Reference](https://tanstack.com/ai/latest/docs/reference/interfaces/ToolDefinition)

## Implementation

### Phase 1: Foundation — Effect Runtime & First Service

**Goal:** Get Effect running in the main process with one real service, proving the pattern works in our Electron build.

- [ ] Install dependencies:
  - `effect` (core — v3.x stable; evaluate v4 beta if stable enough by implementation time)
  - `@effect/platform-node` (Node.js platform services)
  - `@effect/sql` + `@effect/sql-sqlite-node` (for Spec 56 alignment)
- [ ] Create `src/main/runtime.ts` — application-level Effect runtime:
  ```typescript
  import { ManagedRuntime } from "effect"

  // AppLayer composes all service layers
  export const AppRuntime = ManagedRuntime.make(AppLayer)

  // Entry point for running Effects from non-Effect code (IPC handlers)
  export const runEffect = <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
    AppRuntime.runPromise(effect)
  ```
- [ ] Create `src/main/services/` directory for Effect service definitions
- [ ] Create first service — `LoggerService`:
  ```typescript
  // src/main/services/logger-service.ts
  import { Context, Layer, Effect } from "effect"

  interface LoggerService {
    readonly info: (namespace: string, message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly warn: (namespace: string, message: string, data?: Record<string, unknown>) => Effect.Effect<void>
    readonly error: (namespace: string, message: string, data?: Record<string, unknown>) => Effect.Effect<void>
  }

  class Logger extends Context.Tag("@openwaggle/Logger")<Logger, LoggerService>() {}

  // Live implementation wraps existing createLogger
  const LoggerLive = Layer.succeed(Logger, { ... })
  ```
  - This wraps the existing `createLogger()` from `src/main/logger.ts`
  - Proving the service pattern works without changing behavior
- [ ] Verify Effect bundling in `electron.vite.config.ts`:
  - Effect is ESM-only — ensure it's included in `externalizeDeps.exclude` (like TanStack AI packages)
  - Test production build includes Effect correctly
- [ ] Verify no CSP/sandbox issues with Effect in Electron main process

### Phase 2: Core Services — Provider Registry & Settings

**Goal:** Migrate the two most-used singletons to Effect service layers.

- [ ] Create `ProviderRegistryService`:
  ```typescript
  // src/main/services/provider-registry-service.ts
  class ProviderRegistry extends Context.Tag("@openwaggle/ProviderRegistry")<
    ProviderRegistry,
    {
      readonly getProviderForModel: (modelId: string) => Effect.Effect<ProviderDefinition, ModelNotFoundError>
      readonly createAdapter: (modelId: string, apiKey: string) => Effect.Effect<ChatAdapter, ProviderError>
      readonly getAllModels: () => Effect.Effect<GroupedModelList>
    }
  >() {}
  ```
  - Wraps existing `src/main/providers/provider-registry.ts` singleton
  - Typed errors: `ModelNotFoundError`, `ProviderError`, `MissingApiKeyError`
  - Layer depends on `SettingsService` for API keys

- [ ] Create `SettingsService`:
  ```typescript
  class Settings extends Context.Tag("@openwaggle/Settings")<
    Settings,
    {
      readonly get: <T>(key: string, schema: Schema.Schema<T>) => Effect.Effect<T | undefined>
      readonly set: (key: string, value: unknown) => Effect.Effect<void>
      readonly getApiKey: (provider: string) => Effect.Effect<string, MissingApiKeyError>
    }
  >() {}
  ```
  - Wraps existing `electron-store` settings (or SQLite if Spec 56 lands first)
  - Note: uses Effect Schema instead of Zod for validation

- [ ] Create `FileSystemService` (thin wrapper over Node fs with Effect):
  ```typescript
  class FileSystem extends Context.Tag("@openwaggle/FileSystem")<
    FileSystem,
    {
      readonly readFile: (path: string) => Effect.Effect<string, FileNotFoundError | FileReadError>
      readonly writeFile: (path: string, content: string) => Effect.Effect<void, FileWriteError>
      readonly exists: (path: string) => Effect.Effect<boolean>
    }
  >() {}
  ```
  - Can also use `@effect/platform-node/NodeFileSystem` directly
  - Typed errors for every operation

- [ ] Compose `AppLayer`:
  ```typescript
  const AppLayer = Layer.mergeAll(
    LoggerLive,
    SettingsLive,
    ProviderRegistryLive,
    FileSystemLive,
  )
  ```

### Phase 3: Effect Schema Migration (Aggressive)

**Goal:** Replace all 88+ Zod schemas with Effect Schema equivalents. This is the largest phase.

**Migration Order (dependencies first):**

#### 3a: Shared schemas (`src/shared/schemas/`)

- [ ] Migrate `src/shared/schemas/validation.ts` (20 schemas):
  - `z.object()` → `Schema.Struct({})`
  - `z.string()` → `Schema.String`
  - `z.number()` → `Schema.Number`
  - `z.boolean()` → `Schema.Boolean`
  - `z.array()` → `Schema.Array()`
  - `z.enum()` → `Schema.Literal()` union or `Schema.Enums()`
  - `z.literal()` → `Schema.Literal()`
  - `z.union()` → `Schema.Union()`
  - `z.discriminatedUnion()` → tagged union with `Schema.Union()` + `_tag`
  - `z.lazy()` → `Schema.suspend()` (for recursive `jsonValueSchema`, `settingsValueSchema`)
  - `z.record()` → `Schema.Record({})`
  - `.optional()` → `Schema.optional()`
  - `.nullable()` → `Schema.NullOr()`
  - `.default()` → `Schema.withDefault()`
  - `.catch()` → `Schema.withDefault()` or `Schema.transformOrFail()` with fallback
  - `.loose()` → use `{ ...fields }` without strict — Effect Schema is open by default (or use `Schema.Struct` which is strict, vs record extension)
  - `.describe()` → `Schema.annotations({ description: "..." })`
  - `.refine()` → `Schema.filter()`
  - `.min()/.max()` → `Schema.minLength()` / `Schema.maxLength()` or `Schema.between()`
  - `.int()` → `Schema.Int`
  - `.positive()` → `Schema.Positive`
  - `z.infer<typeof schema>` → `Schema.Type<typeof schema>`
  - `.safeParse()` → `Schema.decodeUnknownEither(schema)(data)`
  - `.parse()` → `Schema.decodeUnknownSync(schema)(data)`
  - `ZodError` → `ParseError` from `@effect/schema`

- [ ] Migrate `src/shared/schemas/waggle.ts` (5 schemas)
- [ ] Migrate `src/shared/types/mcp.ts` (1 schema)
- [ ] Migrate `src/shared/types/question.ts` (4 schemas)
- [ ] Migrate `src/shared/types/plan.ts` (1 schema — discriminated union)
- [ ] Migrate `src/shared/types/errors.ts` (1 schema with `.refine()`)

#### 3b: Persistence schemas

- [ ] Migrate `src/main/store/conversations.ts` (7 schemas — **most complex**):
  - `messagePartSchema` — union of 6 variants with backward compat (`'thinking'` → `'reasoning'`)
  - `conversationSchema` — deeply nested with message arrays
  - Preserve backward compatibility for stored JSON files
  - Test: load existing conversation JSON through new schemas
- [ ] Migrate `src/main/store/settings.ts` (4+ schemas)
- [ ] Migrate `src/main/auth/token-manager.ts` (2 schemas)

#### 3c: Tool input schemas (20 files)

- [ ] Update `defineOpenWaggleTool` in `src/main/tools/define-tool.ts`:
  - Change `inputSchema: T` from `z.ZodType` to `Schema.Schema<any, any>`
  - Use `Schema.standardSchemaV1(schema)` to pass to TanStack AI's `toolDefinition()` (Standard Schema interop)
  - Use `Schema.decodeUnknownSync(schema)(args)` instead of `schema.parse(args)` for runtime validation
  - Type inference: `Schema.Type<T>` instead of `z.infer<T>`
- [ ] Migrate each tool file (20 files in `src/main/tools/tools/`):
  - `read-file.ts`, `write-file.ts`, `edit-file.ts`, `run-command.ts`, `glob.ts`, `list-files.ts`
  - `ask-user.ts`, `propose-plan.ts`, `load-skill.ts`, `load-agents.ts`
  - `orchestrate.ts`, `spawn-agent.ts`, `send-message.ts`, `web-fetch.ts`
  - `task-*.ts` (3 files), `team-*.ts` (2 files)
  - Each file: replace `z.` imports with `Schema.` equivalents

#### 3d: IPC, agent, and orchestration schemas

- [ ] Migrate `src/main/ipc/typed-ipc.ts` — replace `ZodError` handling with `ParseError`
- [ ] Migrate `src/main/agent/message-mapper.ts` (2 schemas)
- [ ] Migrate `src/main/agent/stream-part-collector.ts` (1 schema)
- [ ] Migrate `src/main/config/project-config.ts`
- [ ] Migrate orchestration schemas in `src/main/orchestration/`

#### 3e: Cleanup

- [ ] Remove `zod` from `package.json` dependencies
- [ ] Remove Zod v4 skill references if they exist
- [ ] Update all `z.infer` → `Schema.Type` across codebase
- [ ] Update all `.safeParse()` → `Schema.decodeUnknownEither()` calls
- [ ] Update CLAUDE.md to reference Effect Schema instead of Zod:
  - Replace "Zod schemas for runtime validation" with "Effect Schema for runtime validation"
  - Update coding conventions section
  - Update tool system documentation
- [ ] Update `tasks/lessons.md` if any Zod-specific rules need revision

### Phase 4: Agent Loop — Effect-based Orchestration

**Goal:** Migrate the agent loop from async/await to Effect, gaining typed errors, structured concurrency, and service injection.

- [ ] Create typed errors for agent operations:
  ```typescript
  class ProviderError extends Data.TaggedError("ProviderError")<{ message: string; provider: string }> {}
  class StreamStallError extends Data.TaggedError("StreamStall")<{ durationMs: number }> {}
  class ToolExecutionError extends Data.TaggedError("ToolExecution")<{ tool: string; message: string }> {}
  class AgentCancelledError extends Data.TaggedError("AgentCancelled")<{}> {}
  ```

- [ ] Migrate `src/main/agent/agent-loop.ts` to Effect:
  - Replace `async function runAgentLoop()` with `Effect.gen(function* () { ... })`
  - `yield*` for service access: `const registry = yield* ProviderRegistry`
  - Stream processing via `Effect.forEach` or `Stream` module
  - Cancellation via `Fiber.interrupt` instead of `AbortController`
  - Retry logic via `Effect.retry(Schedule.exponential(...))`
  - Stall detection via `Effect.timeout`

- [ ] Migrate tool context from `AsyncLocalStorage` to Effect service:
  ```typescript
  class ToolCtx extends Context.Tag("@openwaggle/ToolContext")<
    ToolCtx,
    ToolContext
  >() {}
  ```
  - Tool execution runs within a scoped layer that provides `ToolCtx`
  - No more `getToolContext()` that throws — service is guaranteed by the type system

- [ ] Migrate `src/main/agent/stream-part-collector.ts` to Effect
- [ ] Migrate `src/main/agent/phase-tracker.ts` to Effect service

### Phase 5: IPC Handlers — Effect Integration

**Goal:** IPC handlers use `runEffect()` to execute Effects, with proper error translation.

- [ ] Create `src/main/ipc/effect-ipc.ts`:
  ```typescript
  function typedHandleEffect<C extends keyof IpcInvokeChannelMap>(
    channel: C,
    handler: (...args: IpcInvokeArgs<C>) => Effect.Effect<IpcInvokeReturn<C>, AppError, AppServices>
  ): void {
    ipcMain.handle(channel, async (_event, ...args) => {
      return AppRuntime.runPromise(handler(...args))
    })
  }
  ```
  - Bridges Effect world back to Electron's callback-based IPC
  - Translates Effect failures to IPC error responses
  - All existing `typedHandle` calls can be incrementally migrated

- [ ] Migrate IPC handlers incrementally (highest-value first):
  - `agent:send-message` — complex orchestration, benefits most
  - `conversations:*` — persistence operations
  - `settings:*` — settings operations
  - `providers:*` — provider operations
  - Others as touched

### Phase 6: Persistence — Effect SQL (Aligns with Spec 56)

**Goal:** If Spec 56 (SQLite) is implemented concurrently, use `@effect/sql-sqlite-node` instead of raw `better-sqlite3`.

- [ ] Use `@effect/sql-sqlite-node` for SQLite access:
  ```typescript
  import { SqliteMigrator } from "@effect/sql-sqlite-node"
  import { SqlClient } from "@effect/sql"

  const SqlLive = SqliteClient.layer({
    filename: Config.succeed(`${userData}/openwaggle.db`)
  })
  ```
- [ ] Define repositories as Effect services with `SqlClient` dependency
- [ ] Migrations via `SqliteMigrator` (Effect's built-in migration system)
- [ ] This replaces the manual migration system planned in Spec 56

---

## Zod → Effect Schema Migration Cheatsheet

| Zod v4 | Effect Schema | Notes |
|--------|--------------|-------|
| `z.object({ name: z.string() })` | `Schema.Struct({ name: Schema.String })` | |
| `z.array(z.string())` | `Schema.Array(Schema.String)` | |
| `z.enum(['a', 'b'])` | `Schema.Literal('a', 'b')` | Or `Schema.Enums(enum)` |
| `z.union([a, b])` | `Schema.Union(a, b)` | |
| `z.discriminatedUnion('type', [...])` | `Schema.Union(a, b)` with `_tag` | Effect uses `_tag` by convention |
| `z.literal('foo')` | `Schema.Literal('foo')` | |
| `z.record(z.string(), z.number())` | `Schema.Record({ key: Schema.String, value: Schema.Number })` | |
| `z.lazy(() => schema)` | `Schema.suspend(() => schema)` | For recursive schemas |
| `.optional()` | `Schema.optional()` | |
| `.nullable()` | `Schema.NullOr()` | |
| `.default(val)` | `Schema.withDefault(() => val)` | |
| `.catch(val)` | `Schema.withDefault(() => val)` | For fallback on parse failure |
| `.loose()` | Default behavior (structs are open) or `Schema.Struct({}).pipe(Schema.extend(...))` | Effect structs strip unknown keys by default — check behavior |
| `.describe('text')` | `Schema.annotations({ description: 'text' })` | |
| `.refine(fn)` | `Schema.filter(fn)` | |
| `.min(n)` / `.max(n)` | `Schema.minLength(n)` / `Schema.maxLength(n)` | For strings/arrays |
| `.int()` | `Schema.Int` | |
| `.positive()` | `Schema.Positive` | |
| `z.infer<typeof s>` | `Schema.Type<typeof s>` | |
| `schema.parse(data)` | `Schema.decodeUnknownSync(schema)(data)` | Throws on failure |
| `schema.safeParse(data)` | `Schema.decodeUnknownEither(schema)(data)` | Returns `Either` |
| `ZodError` | `ParseError` | From `@effect/schema/ParseResult` |
| Standard Schema interop | `Schema.standardSchemaV1(schema)` | For TanStack AI tools |

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/runtime.ts` | Application Effect runtime + AppLayer |
| `src/main/services/logger-service.ts` | Logger as Effect service |
| `src/main/services/provider-registry-service.ts` | Provider registry as Effect service |
| `src/main/services/settings-service.ts` | Settings as Effect service |
| `src/main/services/file-system-service.ts` | File system as Effect service |
| `src/main/services/tool-context-service.ts` | Tool context as Effect service (replaces AsyncLocalStorage) |
| `src/main/errors.ts` | Tagged error definitions for domain errors |
| `src/main/ipc/effect-ipc.ts` | Effect ↔ IPC bridge utilities |

## Files to Modify (Major)

| File | Change |
|------|--------|
| `src/shared/schemas/validation.ts` | All 20 schemas: Zod → Effect Schema |
| `src/shared/schemas/waggle.ts` | 5 schemas: Zod → Effect Schema |
| `src/shared/types/question.ts` | 4 schemas: Zod → Effect Schema |
| `src/shared/types/plan.ts` | 1 schema: Zod → Effect Schema |
| `src/shared/types/mcp.ts` | 1 schema: Zod → Effect Schema |
| `src/shared/types/errors.ts` | 1 schema: Zod → Effect Schema |
| `src/main/store/conversations.ts` | 7 schemas + persistence logic → Effect Schema + Effect service |
| `src/main/store/settings.ts` | Settings schemas + store → Effect Schema + Effect service |
| `src/main/tools/define-tool.ts` | `z.ZodType` → `Schema.Schema` + Standard Schema adapter |
| `src/main/tools/tools/*.ts` | All 20 tool files: input schemas → Effect Schema |
| `src/main/agent/agent-loop.ts` | async/await → Effect.gen with services |
| `src/main/ipc/typed-ipc.ts` | ZodError → ParseError handling |
| `src/main/providers/provider-registry.ts` | Singleton → Effect service |
| `src/main/config/project-config.ts` | Zod schemas → Effect Schema |
| `src/main/auth/token-manager.ts` | 2 schemas: Zod → Effect Schema |
| `electron.vite.config.ts` | Add `effect` to externalizeDeps.exclude |
| `package.json` | Add effect ecosystem; remove zod |
| `CLAUDE.md` | Update validation patterns, coding conventions |

## Cross-References

- **Spec 56 (SQLite)** — Phase 6 uses `@effect/sql-sqlite-node` instead of raw better-sqlite3. If Spec 59 ships first, Spec 56 should use Effect SQL directly.
- **Spec 55 (Checkpoint)** — Checkpoint capture/revert can use Effect services for file I/O with typed errors.
- **All specs 52-58** — New code written for any spec should use Effect Schema instead of Zod if this spec is in progress or complete.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Effect learning curve for contributors | High | Create Effect skill/guide; comprehensive examples in first services |
| 88+ schema migration is error-prone | High | Migration by module with tests; parallel Zod/Effect validation during transition |
| TanStack AI Standard Schema interop issues | Medium | Verify `Schema.standardSchemaV1()` works with `toolDefinition()` before Phase 3c |
| Effect bundling in Electron | Medium | Verify in Phase 1 before deep investment |
| Effect v3 → v4 migration during adoption | Medium | Start with v3 stable; v4 when it stabilizes; migration path is documented |
| Performance regression from Effect overhead | Low | Effect is zero-cost for simple operations; benchmark critical paths |
| Test suite breakage during schema migration | High | Migrate tests alongside schemas; CI must stay green at each phase boundary |

## Definition of Done

1. Effect runtime running in main process with service layer composition
2. All 88+ Zod schemas migrated to Effect Schema
3. Zod fully removed from dependencies
4. Agent loop uses Effect with typed errors and service injection
5. IPC handlers bridge Effect ↔ Electron IPC
6. Tool context uses Effect service instead of AsyncLocalStorage
7. All existing tests pass with Effect Schema validation
8. Production build (all platforms) works correctly with Effect
9. CLAUDE.md updated with Effect patterns and conventions
10. No runtime behavior changes — all existing functionality preserved

## Testing Strategy

- **Phase 1:** Build verification — production build with Effect, no runtime errors
- **Phase 3:** Schema-by-schema migration tests:
  - For each migrated schema: test that identical input produces identical parsed output
  - Fixture-based: save current Zod parse results as snapshots, verify Effect Schema matches
  - Backward compat: existing conversation JSON files parse correctly through Effect schemas
- **Phase 4:** Agent loop tests — existing integration tests pass with Effect-based loop
- **Phase 5:** IPC handler tests — existing invoke/send patterns work unchanged
- **Regression:** Full `pnpm test` must pass at each phase boundary before proceeding
