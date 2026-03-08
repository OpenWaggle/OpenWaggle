# Spec 59 — Effect-TS Adoption: Implementation Plan

**Status:** Planning
**Branch:** `feat/effect-ts-adoption`
**Estimated Phases:** 6 (incremental, each phase leaves CI green)
**Reference implementations:** [T3code](https://github.com/pingdotgg/t3code) (Effect Schema contracts, event-sourced orchestration), [EffectiveAgent](https://github.com/PaulJPhilp/EffectiveAgent) (Effect service/layer DI, tool system)

---

## T3code Reference Architecture (North Star)

T3code's architecture validates every major decision in this migration:

| T3code Pattern | Our Migration Equivalent |
|---|---|
| `packages/contracts/` uses Effect Schema exclusively — branded IDs via `Schema.brand()`, reusable primitives (`TrimmedString`, `NonNegativeInt`, `IsoDateTime`) | Phase 3: migrate `src/shared/schemas/` to Effect Schema with branded constructors |
| Server is Effect-native: `ManagedRuntime`, `@effect/platform-node`, `@effect/sql-sqlite-bun` | Phase 1-2: create `AppRuntime`, service layers; Phase 6: `@effect/sql-sqlite-node` |
| Event-sourced orchestration with typed commands/events, sequence numbers, causation chains | Phase 4: typed agent events as `Data.TaggedClass`, stream processing via Effect |
| Desktop is a thin Electron shell — no agent logic in desktop process | Already matches: our main process is the "server" equivalent |
| Web (renderer) stays React + Zustand + TanStack — no Effect in frontend | Same: Effect stays in main process only |
| `NativeApi` interface organizes all IPC into typed domains | Phase 5: `typedHandleEffect` bridges Effect ↔ Electron IPC |
| Provider sessions with typed statuses (`connecting/ready/running/error/closed`) | Phase 2: `ProviderRegistryService` with `Data.TaggedError` for each failure mode |

### T3code Effect Schema Patterns to Adopt

```typescript
// T3code: Branded entity IDs (packages/contracts/baseSchemas.ts)
const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"))
type ThreadId = Schema.Type<typeof ThreadId>

// Our equivalent:
const ConversationId = Schema.String.pipe(Schema.brand("ConversationId"))
type ConversationId = Schema.Type<typeof ConversationId>

// T3code: Reusable primitives
const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.trim,
  Schema.nonEmptyString()
)
const NonNegativeInt = Schema.Number.pipe(Schema.int(), Schema.nonNegative())
const IsoDateTime = Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}T/))

// T3code: Event-sourced commands/events with causation
const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread:turn:start"),
  threadId: ThreadId,
  correlationId: Schema.String,
  sequenceNumber: NonNegativeInt,
  // ...
})
```

### EffectiveAgent Service Patterns to Adopt

```typescript
// EffectiveAgent: Service with effect constructor + dependencies
class AgentRuntimeService extends Effect.Service<AgentRuntimeServiceApi>()(
  "AgentRuntimeService", {
    effect: Effect.gen(function*() {
      const modelService = yield* ModelService
      const providerService = yield* ProviderService
      return { /* API implementation */ }
    }),
    dependencies: [ModelService.Default, ProviderService.Default]
  }
) {}

// EffectiveAgent: Tool validation via Schema
const toolInput = Schema.decodeUnknownSync(tool.inputSchema)(rawArgs)

// EffectiveAgent: Mutable runtime state via Ref
const agentStates = yield* Ref.make(new Map<AgentId, Ref<AgentState>>())
```

---

## Current State Inventory

| Category | Count | Key Files |
|---|---|---|
| Zod imports | 62 files | Across main + shared + 2 renderer files |
| Schema definitions | 68 schemas | `validation.ts` (20), `conversations.ts` (7), tools (20), rest scattered |
| `.parse()` / `.safeParse()` calls | 71+ sites | Tool args, persistence, IPC |
| `z.infer<>` usage | 28 instances | Tool signatures, persistence types |
| `ZodError` handling | 7 files | `typed-ipc.ts` is the linchpin |
| AsyncLocalStorage | 1 pattern | `define-tool.ts` → `ToolContext` |
| Singletons | 6 major | `providerRegistry`, question/plan managers, sub-agent registries |
| try/catch blocks | 154 total | File I/O, network, JSON, validation, streams |

---

## Phase 1: Foundation — Effect Runtime & Build Verification

**Goal:** Prove Effect works in our Electron main process build pipeline. Zero behavior changes.

### 1.1 Install dependencies

```bash
pnpm add effect @effect/platform @effect/platform-node
```

Note: `@effect/schema` is included in `effect` v3.x (no separate install). Evaluate v4 beta status at implementation time.

### 1.2 Configure electron-vite bundling

Add Effect packages to `externalizeDeps.exclude` in `electron.vite.config.ts`:

```typescript
externalizeDeps: {
  exclude: [
    // ... existing TanStack packages ...
    'effect',
    '@effect/platform',
    '@effect/platform-node',
  ],
},
```

**T3code reference:** T3code uses `tsdown` (not electron-vite), but the same ESM-bundling principle applies — Effect is ESM-only and must be bundled into CJS output.

### 1.3 Create tagged error types

**File:** `src/main/errors.ts`

Define all domain errors upfront as `Data.TaggedError` (T3code pattern: typed error hierarchies per domain):

```typescript
import { Data } from "effect"

// Provider domain
export class ModelNotFoundError extends Data.TaggedError("ModelNotFoundError")<{
  readonly modelId: string
}> {}

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly provider: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class MissingApiKeyError extends Data.TaggedError("MissingApiKeyError")<{
  readonly provider: string
}> {}

// Agent domain
export class AgentCancelledError extends Data.TaggedError("AgentCancelled")<{}> {}

export class StreamStallError extends Data.TaggedError("StreamStall")<{
  readonly durationMs: number
}> {}

export class ToolExecutionError extends Data.TaggedError("ToolExecution")<{
  readonly tool: string
  readonly message: string
}> {}

// File system domain
export class FileNotFoundError extends Data.TaggedError("FileNotFound")<{
  readonly path: string
}> {}

export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class FileWriteError extends Data.TaggedError("FileWriteError")<{
  readonly path: string
  readonly cause: unknown
}> {}

// Validation domain
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly channel: string
  readonly issues: readonly string[]
}> {}
```

### 1.4 Create LoggerService (first service, wraps existing)

**File:** `src/main/services/logger-service.ts`

Following EffectiveAgent's `Effect.Service` pattern:

```typescript
import { Context, Effect, Layer } from "effect"
import { createLogger as createRawLogger } from "../logger"

interface LoggerService {
  readonly info: (namespace: string, message: string, data?: object) => Effect.Effect<void>
  readonly warn: (namespace: string, message: string, data?: object) => Effect.Effect<void>
  readonly error: (namespace: string, message: string, data?: object) => Effect.Effect<void>
  readonly debug: (namespace: string, message: string, data?: object) => Effect.Effect<void>
}

export class AppLogger extends Context.Tag("@openwaggle/Logger")<AppLogger, LoggerService>() {
  static Live = Layer.succeed(AppLogger, {
    info: (ns, msg, data) => Effect.sync(() => createRawLogger(ns).info(msg, data)),
    warn: (ns, msg, data) => Effect.sync(() => createRawLogger(ns).warn(msg, data)),
    error: (ns, msg, data) => Effect.sync(() => createRawLogger(ns).error(msg, data)),
    debug: (ns, msg, data) => Effect.sync(() => createRawLogger(ns).debug(msg, data)),
  })
}
```

**T3code reference:** T3code uses Effect's built-in `Logger` module. We wrap our existing logger to avoid disrupting the file-based logging infrastructure.

### 1.5 Create AppRuntime

**File:** `src/main/runtime.ts`

```typescript
import { ManagedRuntime, Layer } from "effect"
import { AppLogger } from "./services/logger-service"

// Phase 1: minimal layer — grows as services are added
const AppLayer = Layer.mergeAll(
  AppLogger.Live,
)

export type AppServices = Layer.Layer.Success<typeof AppLayer>

export const AppRuntime = ManagedRuntime.make(AppLayer)
```

**T3code reference:** T3code's server creates a `ManagedRuntime` from composed layers at startup. Same pattern.

### 1.6 Verification

- [ ] `pnpm build` succeeds (all platforms)
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` all pass
- [ ] Runtime: import `AppRuntime` in `src/main/index.ts`, run a trivial effect at startup to prove it works
- [ ] Production build: verify Effect is bundled correctly (not externalized)

### Checklist

- [ ] Install `effect`, `@effect/platform`, `@effect/platform-node`
- [ ] Add to `externalizeDeps.exclude` in electron.vite.config.ts
- [ ] Create `src/main/errors.ts` with tagged error types
- [ ] Create `src/main/services/logger-service.ts`
- [ ] Create `src/main/runtime.ts` with `AppRuntime`
- [ ] Smoke-test in `src/main/index.ts`
- [ ] All tests pass, build succeeds

---

## Phase 2: Core Services — Provider Registry & Settings

**Goal:** Migrate the two most critical singletons to Effect service layers, proving the DI pattern works.

### 2.1 ProviderRegistryService

**File:** `src/main/services/provider-registry-service.ts`

```typescript
export class ProviderRegistryService extends Context.Tag(
  "@openwaggle/ProviderRegistry"
)<ProviderRegistryService, {
  readonly getProviderForModel: (modelId: string) =>
    Effect.Effect<ProviderDefinition, ModelNotFoundError>
  readonly createAdapter: (modelId: string, apiKey: string) =>
    Effect.Effect<ChatAdapter, ProviderError>
  readonly getAllModels: () => Effect.Effect<GroupedModelList>
  readonly isKnownModel: (modelId: string) => Effect.Effect<boolean>
}>() {
  static Live = Layer.effect(ProviderRegistryService,
    Effect.gen(function* () {
      // Wraps existing providerRegistry singleton
      // Methods return Effect with typed errors instead of undefined/throw
    })
  )
}
```

**Strategy:** Wrap the existing `providerRegistry` singleton — don't rewrite it. The class stays, the service adds typed error channels.

**T3code reference:** T3code's provider sessions have typed statuses. We add typed errors: `ModelNotFoundError` when model lookup fails, `MissingApiKeyError` when API key is missing.

### 2.2 SettingsService

**File:** `src/main/services/settings-service.ts`

```typescript
export class SettingsService extends Context.Tag(
  "@openwaggle/Settings"
)<SettingsService, {
  readonly get: <T>(key: string) => Effect.Effect<T | undefined>
  readonly set: (key: string, value: unknown) => Effect.Effect<void>
  readonly getApiKey: (provider: string) => Effect.Effect<string, MissingApiKeyError>
  readonly getProviderConfig: (provider: string) =>
    Effect.Effect<ProviderConfig | undefined>
}>() {
  static Live = Layer.effect(SettingsService,
    Effect.gen(function* () {
      // Wraps existing electron-store settings
      // Uses Effect.sync for synchronous store reads
      // Uses Semaphore for concurrent write protection (replaces AsyncMutex)
    })
  )
}
```

**Replaces:** `AsyncMutex` in settings store → `Effect.Semaphore` for concurrent write protection.

### 2.3 FileSystemService

**File:** `src/main/services/file-system-service.ts`

Option A: Use `@effect/platform-node/NodeFileSystem` directly (T3code approach).
Option B: Thin wrapper for typed errors specific to our domain.

**Recommendation:** Option A with domain error mapping:

```typescript
import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"

export class AppFileSystem extends Context.Tag(
  "@openwaggle/FileSystem"
)<AppFileSystem, {
  readonly readFile: (path: string) => Effect.Effect<string, FileNotFoundError | FileReadError>
  readonly writeFile: (path: string, content: string) => Effect.Effect<void, FileWriteError>
  readonly exists: (path: string) => Effect.Effect<boolean>
}>() {
  static Live = Layer.effect(AppFileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return {
        readFile: (path) => fs.readFileString(path).pipe(
          Effect.mapError((e) => new FileNotFoundError({ path }))
        ),
        // ...
      }
    })
  ).pipe(Layer.provide(NodeFileSystem.layer))
}
```

### 2.4 Compose AppLayer

```typescript
// src/main/runtime.ts (updated)
const AppLayer = Layer.mergeAll(
  AppLogger.Live,
  SettingsService.Live,
  ProviderRegistryService.Live,
  AppFileSystem.Live,
)
```

**EffectiveAgent reference:** Their `baseLayer = Layer.mergeAll(ConfigurationService.Default, ModelService.Default, ProviderService.Default, NodeFileSystem.layer, ...)` — same composition pattern.

### Checklist

- [ ] Create `ProviderRegistryService` wrapping existing singleton
- [ ] Create `SettingsService` wrapping electron-store + replace AsyncMutex with Semaphore
- [ ] Create `AppFileSystem` using `@effect/platform-node`
- [ ] Update `AppLayer` in `runtime.ts`
- [ ] Write unit tests for each service (provide test layers)
- [ ] All existing tests still pass

---

## Phase 3: Effect Schema Migration (Largest Phase)

**Goal:** Replace all 68 Zod schemas with Effect Schema. Remove `zod` from dependencies.

### Migration Strategy

**Order matters:** dependencies first, consumers second.

```
shared/schemas/ → shared/types/ → main/store/ → main/tools/ → main/agent/ → main/ipc/
```

### T3code Schema Patterns to Follow

T3code's `packages/contracts/baseSchemas.ts` establishes reusable primitives. We do the same:

**File:** `src/shared/schemas/primitives.ts` (NEW)

```typescript
import { Schema } from "effect"

// Branded entity IDs (replaces src/shared/types/brand.ts constructors)
export const ConversationId = Schema.String.pipe(Schema.brand("ConversationId"))
export type ConversationId = Schema.Type<typeof ConversationId>

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"))
export type MessageId = Schema.Type<typeof MessageId>

export const ToolCallId = Schema.String.pipe(Schema.brand("ToolCallId"))
export type ToolCallId = Schema.Type<typeof ToolCallId>

// Reusable primitives (T3code pattern)
export const NonNegativeInt = Schema.Number.pipe(Schema.int(), Schema.nonNegative())
export const PositiveInt = Schema.Number.pipe(Schema.int(), Schema.positive())
export const NonEmptyString = Schema.String.pipe(Schema.nonEmptyString())
export const IsoDateTimeString = Schema.String.pipe(
  Schema.annotations({ description: "ISO 8601 date-time string" })
)
```

### 3a: Shared Schemas (`src/shared/schemas/`)

**File:** `src/shared/schemas/validation.ts` — 20 schemas

Migration reference for key patterns:

| Current Zod | Effect Schema |
|---|---|
| `z.lazy(() => z.union([...]))` for `jsonValueSchema` | `Schema.suspend(() => Schema.Union(...))` |
| `.loose()` on structs | Effect structs strip unknown keys by default. Use `Schema.Struct({...}).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown })))` for open structs |
| `.catch(undefined)` for graceful degradation | `Schema.optional(Schema.Number).pipe(Schema.withDefault(() => undefined))` |
| `z.enum(ORCHESTRATION_RUN_STATUSES)` | `Schema.Literal(...ORCHESTRATION_RUN_STATUSES)` |

**Critical pattern — `.loose()` replacement:**

T3code doesn't use `.loose()` — they define exactly the fields they need. For our backward-compat needs with persisted data, use `onExcessProperty: "ignore"` in decode options:

```typescript
const result = Schema.decodeUnknownSync(schema, { onExcessProperty: "ignore" })(data)
```

This is cleaner than extending with `Schema.Record` and matches T3code's approach of explicit fields.

### 3b: Persistence Schemas

**File:** `src/main/store/conversations.ts` — 7 schemas (MOST COMPLEX)

Critical: `messagePartSchema` union with backward compatibility:

```typescript
// Effect Schema version
const MessagePartText = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
})

const MessagePartReasoning = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
})

// Backward compat: "thinking" → "reasoning" via transform
const MessagePartThinkingCompat = Schema.transform(
  Schema.Struct({ type: Schema.Literal("thinking"), text: Schema.String }),
  MessagePartReasoning,
  {
    decode: ({ text }) => ({ type: "reasoning" as const, text }),
    encode: ({ text }) => ({ type: "thinking" as const, text }),
  }
)

const MessagePartSchema = Schema.Union(
  MessagePartText,
  MessagePartReasoning,
  MessagePartThinkingCompat,
  MessagePartAttachment,
  MessagePartToolCall,
  MessagePartToolResult,
)
```

**T3code reference:** T3code uses discriminated unions with explicit `type` literals in every struct. Same pattern.

**Testing strategy:** Snapshot-based regression — save current Zod parse outputs as fixtures, verify Effect Schema produces identical results.

### 3c: Tool Input Schemas (20 files)

**Step 1:** Update `defineOpenWaggleTool` signature:

```typescript
import { Schema } from "effect"

export function defineOpenWaggleTool<
  S extends Schema.Schema.Any,
  TName extends string,
>(config: {
  name: TName
  description: string
  needsApproval?: boolean
  inputSchema: S
  execute: (args: Schema.Type<S>, context: ToolContext) => Promise<string | NormalizedToolResult>
}): ServerTool {
  const def = toolDefinition({
    name: config.name,
    description: config.description,
    needsApproval: config.needsApproval,
    inputSchema: config.inputSchema,  // Effect Schema implements Standard Schema
  })

  return def.server(async (args: unknown) => {
    const parsed = Schema.decodeUnknownSync(config.inputSchema)(args)
    // ... rest unchanged
  })
}
```

**TanStack AI compatibility:** Effect Schema implements Standard Schema V1 natively. The `inputSchema` field in `toolDefinition()` accepts any Standard Schema compliant validator. No shim needed.

**Verification:** Test one tool first (e.g., `readFile`) end-to-end before migrating all 20.

**Step 2:** Migrate each tool file mechanically:

```typescript
// Before (read-file.ts):
import { z } from 'zod'
inputSchema: z.object({
  path: z.string().describe('File path relative to the project root'),
  maxLines: z.number().optional().describe('Maximum number of lines to read.'),
})

// After:
import { Schema } from "effect"
inputSchema: Schema.Struct({
  path: Schema.String.pipe(Schema.annotations({ description: "File path relative to the project root" })),
  maxLines: Schema.optional(Schema.Number).pipe(
    Schema.annotations({ description: "Maximum number of lines to read." })
  ),
})
```

### 3d: IPC & Agent Schemas

- `typed-ipc.ts`: Replace `ZodError` → `ParseError` from `effect/ParseResult`
- `message-mapper.ts`, `stream-part-collector.ts`: Straightforward schema migration
- Orchestration schemas: Migrate alongside validation.ts schemas they depend on

### 3e: Cleanup

- [ ] Remove `zod` from `package.json` dependencies
- [ ] Remove Zod v4 skill (`.openwaggle/skills/zod-v4/`)
- [ ] Verify no `zod` imports remain: `grep -r "from 'zod'" src/`
- [ ] Update CLAUDE.md: Zod references → Effect Schema
- [ ] Update `tasks/lessons.md`: Zod-specific rules → Effect Schema rules

### Checklist

- [ ] Create `src/shared/schemas/primitives.ts` with branded IDs + reusable types
- [ ] Migrate `validation.ts` (20 schemas)
- [ ] Migrate `waggle.ts` (5 schemas)
- [ ] Migrate shared types: `mcp.ts`, `question.ts`, `plan.ts`, `errors.ts`
- [ ] Migrate `conversations.ts` (7 schemas + backward compat transform)
- [ ] Migrate `settings.ts` (4+ schemas)
- [ ] Migrate `token-manager.ts` (2 schemas)
- [ ] Update `defineOpenWaggleTool` to accept `Schema.Schema`
- [ ] Verify TanStack AI Standard Schema interop (test one tool e2e)
- [ ] Migrate all 20 tool files
- [ ] Migrate IPC schemas (`typed-ipc.ts`, handlers)
- [ ] Migrate agent schemas (`message-mapper.ts`, `stream-part-collector.ts`)
- [ ] Migrate orchestration schemas
- [ ] Migrate MCP schemas
- [ ] Migrate sub-agent schemas
- [ ] Remove `zod` dependency
- [ ] Update CLAUDE.md and lessons.md
- [ ] Snapshot regression tests for persistence schemas
- [ ] All tests pass

---

## Phase 4: Agent Loop — Effect-based Orchestration

**Goal:** Migrate agent loop from async/await to Effect.gen, gaining typed errors, structured concurrency, and service injection.

### 4.1 ToolContext as Effect Service

**File:** `src/main/services/tool-context-service.ts`

```typescript
export class ToolCtx extends Context.Tag("@openwaggle/ToolContext")<
  ToolCtx,
  ToolContext
>() {}
```

Replaces `AsyncLocalStorage`. Tool context is provided via layer scope per agent run.

**T3code reference:** T3code's provider sessions carry context as typed service state, not via AsyncLocalStorage. Same principle: make context a type-level requirement.

### 4.2 Agent Loop Migration

**File:** `src/main/agent/agent-loop.ts`

Current: `async function runAgent(params): Promise<AgentRunResult>`
After: Returns `Effect.Effect<AgentRunResult, AgentError, AppServices>`

```typescript
export const runAgent = (params: AgentRunParams) =>
  Effect.gen(function* () {
    const logger = yield* AppLogger
    const registry = yield* ProviderRegistryService
    const settings = yield* SettingsService

    // Stage 1: Resolve provider (typed error on failure)
    const provider = yield* registry.getProviderForModel(params.model)
    const apiKey = yield* settings.getApiKey(provider.id)

    // Stage 2: Build prompt
    const systemPrompt = yield* Effect.tryPromise({
      try: () => buildAgentPrompt(/*...*/),
      catch: (e) => new ProviderError({ provider: provider.id, message: String(e) }),
    })

    // Stage 3: Stream with timeout + cancellation
    const stream = yield* Effect.tryPromise({
      try: () => chat({ model: provider.createAdapter(params.model), /*...*/ }),
      catch: (e) => new ProviderError({ provider: provider.id, message: String(e) }),
    })

    // Stage 4: Process stream
    const collector = new StreamPartCollector()
    yield* Effect.forEach(stream, (chunk) =>
      Effect.sync(() => {
        params.onChunk(chunk)
        collector.processChunk(chunk)
      })
    )

    return collector.toResult()
  }).pipe(
    // Cancellation via fiber interruption (replaces AbortController)
    Effect.interruptible,
    // Retry on stall
    Effect.retry({
      times: MAX_STALL_RETRIES,
      schedule: Schedule.spaced(Duration.millis(STALL_RETRY_DELAY_MS)),
    }),
    // Provide tool context as scoped layer
    Effect.provideService(ToolCtx, buildToolContext(params)),
  )
```

**Bridge to IPC caller:**

```typescript
// In IPC handler:
const result = await AppRuntime.runPromise(
  runAgent(params).pipe(Effect.scoped)
)
```

### 4.3 Replace Manual Concurrency Patterns

| Current | Effect Replacement |
|---|---|
| `AbortController` + signal wiring | `Fiber.interrupt` / `Effect.interruptible` |
| `AsyncMutex` for settings | `Effect.Semaphore.make(1)` |
| `Promise<T>` + resolve/reject for user questions | `Deferred.make<T>()` + `Deferred.succeed` |
| `withStageTiming` wrapper | `Effect.timed` (returns duration alongside result) |
| `for await (const chunk of stream)` | `Stream.fromAsyncIterable` + `Stream.runForEach` |

### Checklist

- [ ] Create `ToolCtx` service (replaces AsyncLocalStorage)
- [ ] Migrate `runAgent` to `Effect.gen`
- [ ] Replace `AbortController` wiring with fiber interruption
- [ ] Replace `AsyncMutex` with `Effect.Semaphore`
- [ ] Replace manual timing with `Effect.timed`
- [ ] Migrate `StreamPartCollector` to use Effect
- [ ] Migrate `phase-tracker.ts` to Effect service
- [ ] All agent integration tests pass

---

## Phase 5: IPC Handlers — Effect Integration

**Goal:** IPC handlers use `AppRuntime.runPromise()` to execute Effects, with proper error translation.

### 5.1 Effect IPC Bridge

**File:** `src/main/ipc/effect-ipc.ts`

```typescript
import { Effect } from "effect"
import { ParseError } from "effect/ParseResult"
import type { IpcInvokeChannelMap } from "@shared/types/ipc"
import { AppRuntime } from "../runtime"
import { createLogger } from "../logger"

const logger = createLogger("ipc")

export function typedHandleEffect<C extends keyof IpcInvokeChannelMap>(
  channel: C,
  handler: (...args: Parameters<IpcInvokeChannelMap[C]>) =>
    Effect.Effect<ReturnType<IpcInvokeChannelMap[C]>, unknown, AppServices>
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    return AppRuntime.runPromise(
      handler(...args).pipe(
        Effect.catchTag("ValidationError", (e) => {
          logger.warn(`Validation failed on "${channel}"`, { issues: e.issues })
          return Effect.fail(new Error(`Invalid arguments for "${channel}": ${e.issues.join("; ")}`))
        }),
        Effect.catchAll((e) => {
          // Translate Effect failures to IPC-safe errors
          const message = e instanceof Error ? e.message : String(e)
          return Effect.fail(new Error(message))
        })
      )
    )
  })
}
```

### 5.2 Migration Order (highest-value first)

1. `agent:send-message` — Complex orchestration, benefits most from typed errors
2. `conversations:*` — Persistence operations
3. `settings:*` — Settings reads/writes
4. `providers:*` — Model listing, adapter creation
5. Git/attachment/voice handlers — as touched

**Strategy:** Incremental. Existing `typedHandle` calls continue to work. New/modified handlers use `typedHandleEffect`. No big-bang cutover.

### Checklist

- [ ] Create `typedHandleEffect` bridge
- [ ] Migrate `agent:send-message` handler
- [ ] Migrate conversation handlers
- [ ] Migrate settings handlers
- [ ] Migrate provider handlers
- [ ] Verify error translation is correct (IPC errors are serializable)
- [ ] All tests pass

---

## Phase 6: Persistence — Effect SQL (Aligns with Spec 56)

**Goal:** If/when Spec 56 (SQLite) is implemented, use `@effect/sql-sqlite-node` instead of raw `better-sqlite3`.

**Note:** This phase depends on Spec 56 timing. If 56 isn't ready, skip this phase — the JSON file persistence works fine with Effect services from Phase 2.

### 6.1 Install

```bash
pnpm add @effect/sql @effect/sql-sqlite-node
```

### 6.2 SQLite Layer

```typescript
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Config } from "effect"

const SqlLive = SqliteClient.layer({
  filename: Config.succeed(`${userData}/openwaggle.db`)
})
```

### 6.3 Repositories as Effect Services

```typescript
class ConversationRepo extends Context.Tag("@openwaggle/ConversationRepo")<
  ConversationRepo,
  {
    readonly get: (id: ConversationId) => Effect.Effect<Conversation, ConversationNotFoundError>
    readonly save: (conversation: Conversation) => Effect.Effect<void>
    readonly list: () => Effect.Effect<readonly ConversationSummary[]>
    readonly delete: (id: ConversationId) => Effect.Effect<void>
  }
>() {
  static Live = Layer.effect(ConversationRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return {
        get: (id) => sql`SELECT * FROM conversations WHERE id = ${id}`.pipe(/*...*/),
        // ...
      }
    })
  )
}
```

**T3code reference:** T3code uses `@effect/sql-sqlite-bun`. We use `@effect/sql-sqlite-node` (same API, Node runtime).

### Checklist

- [ ] Install `@effect/sql`, `@effect/sql-sqlite-node`
- [ ] Create `SqlLive` layer
- [ ] Create repository services (conversations, settings, teams)
- [ ] Migrations via `SqliteMigrator`
- [ ] Add to `AppLayer`
- [ ] All persistence tests pass

---

## Cross-Cutting Concerns

### Renderer Impact: MINIMAL

Effect stays in main process only. The renderer continues to use React + Zustand + TanStack Query. The only renderer change:

- 2 files (`ToolCallBlock.tsx`, `tool-args.ts`) import `z` for argument display parsing. These can either:
  - Keep a minimal `zod` devDependency for renderer-only usage, or
  - Switch to `JSON.parse` + manual validation (these are display-only, not security boundaries)

**T3code reference:** T3code's web app has zero Effect imports. Same approach.

### Testing Strategy

**Per-phase testing:**

| Phase | Test Approach |
|---|---|
| 1 | Build verification + smoke test |
| 2 | Unit tests for each service (provide test layers) |
| 3 | Snapshot regression: save Zod outputs → verify Effect Schema matches |
| 3c | One tool e2e test before migrating all 20 |
| 4 | Existing agent integration tests must pass |
| 5 | Existing IPC tests must pass |
| 6 | Persistence tests against SQLite |

**EffectiveAgent reference:** Their test pattern uses `it.effect` with fresh layers per test. We should adopt:

```typescript
it.effect("should resolve provider for known model", () =>
  Effect.gen(function* () {
    const registry = yield* ProviderRegistryService
    const provider = yield* registry.getProviderForModel("claude-sonnet-4")
    expect(provider.id).toBe("anthropic")
  }).pipe(Effect.provide(TestLayer))
)
```

### CLAUDE.md Updates (Phase 3e)

After migration, update coding conventions:

```diff
- **Never use `any`** — prefer `unknown` plus narrowing, or Zod schemas for runtime validation.
+ **Never use `any`** — prefer `unknown` plus narrowing, or Effect Schema for runtime validation.

- **Use Zod v4 API** — `.loose()` not `.passthrough()`, `z.globalRegistry` not `z.getSchema()`.
+ **Use Effect Schema** — `Schema.Struct()` for objects, `Schema.decodeUnknownSync()` for parsing,
+   `Schema.Type<>` for type inference. Never use Zod.

+ **Effect service pattern** — use `Context.Tag` + `Layer` for all cross-cutting services.
+   Never create singletons. Use `@openwaggle/<Name>` tag identifiers.
+
+ **Effect error handling** — use `Data.TaggedError` for domain errors.
+   Never throw untyped Error instances in main process code.
```

### Lessons.md Updates

The "never type-cast" rule's Zod references need updating:

```diff
- **Zod v4 validation** — `.parse()` / `.safeParse()` at runtime boundaries
+ **Effect Schema validation** — `Schema.decodeUnknownSync()` / `Schema.decodeUnknownEither()` at runtime boundaries
```

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| Effect learning curve | Create an Effect skill (`.openwaggle/skills/effect-ts/SKILL.md`) with patterns from this plan |
| 68 schema migration errors | Snapshot regression tests: capture Zod outputs before migration, verify Effect Schema matches |
| TanStack AI Standard Schema interop | Verify in Phase 3c with one tool before migrating all 20 |
| Effect bundling in Electron | Verify in Phase 1 before any other work |
| Backward compat for persisted conversations | Transform-based migration (see Phase 3b `MessagePartThinkingCompat` example) |
| CI goes red during migration | Each phase boundary must leave CI green. Schema migration can be done file-by-file within Phase 3 |

---

## Phase Dependencies

```
Phase 1 (Foundation)
  ↓
Phase 2 (Services)
  ↓
Phase 3 (Schema Migration) ←── Can start 3a/3b concurrently with Phase 2
  ↓
Phase 4 (Agent Loop) ←── Requires Phase 2 + 3
  ↓
Phase 5 (IPC Bridge) ←── Requires Phase 4
  ↓
Phase 6 (SQLite) ←── Requires Phase 2, optional, depends on Spec 56
```

Phases 1-3 are the critical path. Phase 3 is the largest by volume (68 schemas across 40+ files) but is mechanically straightforward — the migration cheatsheet covers 95% of cases.

---

## Definition of Done

1. Effect runtime running in main process with service layer composition
2. All 68 Zod schemas migrated to Effect Schema
3. `zod` fully removed from main/shared dependencies
4. Agent loop uses Effect with typed errors and service injection
5. IPC handlers bridge Effect ↔ Electron IPC
6. Tool context uses Effect service instead of AsyncLocalStorage
7. All existing tests pass with Effect Schema validation
8. Production build (all platforms) works correctly with Effect
9. CLAUDE.md updated with Effect patterns and conventions
10. No runtime behavior changes — all existing functionality preserved

---

## Sources

- [Effect-TS Documentation: Services](https://effect.website/docs/requirements-management/services/)
- [Effect-TS Documentation: Layers](https://effect.website/docs/requirements-management/layers/)
- [Effect Schema vs Zod](https://github.com/PaulJPhilp/EffectPatterns/blob/main/content/published/patterns/schema/getting-started/schema-vs-zod.mdx)
- [T3code Repository](https://github.com/pingdotgg/t3code)
- [EffectiveAgent Repository](https://github.com/PaulJPhilp/EffectiveAgent)
- [ManagedRuntime API](https://effect-ts.github.io/effect/effect/ManagedRuntime.ts.html)
