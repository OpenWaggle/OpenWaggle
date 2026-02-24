# Spec 09 — Type Safety Audit: Eliminate All Type Casts

**Goal**: Remove every `as T` cast in the codebase by replacing them with Zod validation, type guards, or structural fixes. After this work, `lessons.md` rule #1 ("Never type-cast") is enforced by the code itself.

**Guiding principle**: Validate at the boundary, infer everywhere else. Every `JSON.parse`, IPC payload, and external API response gets a Zod schema. Discriminated unions and type guards replace manual narrowing.

---

## Phase 0 — Shared foundations

Build the reusable primitives that later phases depend on.

### 0.1 — Shared Node.js error type guard
- [x] Create `src/shared/utils/node-error.ts`
- [x] Export `isNodeError(err: unknown, code?: string): err is NodeJS.ErrnoException`
  - Validates: `typeof err === 'object' && err !== null && 'code' in err`
  - If `code` argument provided, also checks `err.code === code`
- [x] Export convenience: `isEnoent(err: unknown): err is NodeJS.ErrnoException` → calls `isNodeError(err, 'ENOENT')`
- **Replaces**: items #21 (`agents-resolver.ts:226-229`), #22 (`skill-catalog.ts:286-289`), #23 (`conversations.ts:258`)

### 0.2 — Shared React element type guard
- [x] Create `src/renderer/src/lib/react-element-guard.ts`
- [x] Export `isReactElementWithProps<P>(node: ReactNode): node is ReactElement<P>`
  - Validates: `node !== null && typeof node === 'object' && !Array.isArray(node) && 'props' in node`
- **Replaces**: items #19 (`CodeBlock.tsx:21`), #20 (`StreamingText.tsx:18`)

### 0.3 — Shared `parseJsonSafe` utility
- [x] Create `src/shared/utils/parse-json.ts`
- [x] Export `parseJson<T>(raw: string, schema: z.ZodType<T>): T` — wraps `JSON.parse` + `schema.parse()`
- [x] Export `parseJsonSafe<T>(raw: string, schema: z.ZodType<T>): z.SafeParseReturnType<unknown, T>`
- **Used by**: phases 1-4 wherever `JSON.parse(...) as T` appears

---

## Phase 1 — HIGH priority: Persistence & config boundaries (items #3-4, #8-11)

These are `JSON.parse → cast` sites where corrupted disk data silently propagates.

### 1.1 — Settings store (`src/main/store/settings.ts`)

**Lines 47, 116**: `store.get('providers', {}) as Record<string, unknown>`
- [x] Replace with `providerConfigSchema` validation:
  ```
  const storedProviders = z.record(z.string(), providerConfigSchema).safeParse(store.get('providers', {}))
  ```
  Use `.data` on success, `{}` on failure.

**Line 257**: `parsed as Record<string, unknown>` after `JSON.parse`
- [x] Define `encryptedEnvelopeSchema = z.record(z.string(), z.unknown())` for the decrypted JSON envelope
- [x] Replace cast with `encryptedEnvelopeSchema.parse(parsed)`

### 1.2 — Project config TOML (`src/main/config/project-config.ts`)

**Lines 40, 63, 84**: Manual narrowing of TOML parse output
- [x] Define `projectConfigSchema` as a Zod schema matching the expected TOML structure:
  ```
  z.object({
    quality: z.object({
      low: z.object({ temperature: z.number().optional(), topP: z.number().optional() }).optional(),
      medium: z.object({ ... }).optional(),
      high: z.object({ ... }).optional(),
    }).optional(),
  }).passthrough()
  ```
- [x] Replace `parse(raw) as Record` → `projectConfigSchema.parse(parse(raw))`
- [x] Remove manual `typeof` guards that the schema now handles

### 1.3 — Package.json parsing (`src/main/orchestration/project-context.ts`)

**Lines 85, 97, 100, 185**: `JSON.parse(raw) as Record` + `pkg.dependencies as Record`
- [x] Define `packageJsonSchema`:
  ```
  z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
  }).passthrough()
  ```
- [x] Replace both `JSON.parse` sites with `parseJson(raw, packageJsonSchema)`
- [x] Remove the `typeof pkg.dependencies === 'object'` guard — schema handles it

### 1.4 — Run repository (`src/main/orchestration/run-repository.ts`)

**Lines 97, 106**: `JSON.parse(raw) as OrchestrationRunRecord` / `as PersistedRunIndex`
- [x] Define `orchestrationRunRecordSchema` in `src/shared/types/orchestration.ts` matching the `OrchestrationRunRecord` interface
- [x] Define `persistedRunIndexSchema` locally in `run-repository.ts`:
  ```
  z.object({ runIds: z.array(z.string()) })
  ```
- [x] Replace both casts with `parseJson(raw, schema)`

---

## Phase 2 — HIGH priority: Orchestration event pipeline (items #5-7)

`service.ts` has the densest cast cluster. Fix from the inside out.

### 2.1 — Planned task shape (`src/main/orchestration/service.ts:189`)

- [x] Define `plannedTaskSchema`:
  ```
  z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
  })
  ```
- [x] Replace `t as Record<string, unknown>` with `plannedTaskSchema.parse(t)` inside the task iteration
- [x] Infer type from schema: `type PlannedTask = z.infer<typeof plannedTaskSchema>`

### 2.2 — Executor event/payload shapes (`src/main/orchestration/service.ts:290-295`)

- [x] Define `taskToolProgressSchema` matching the existing `TaskToolProgressDetail` interface:
  ```
  z.object({
    type: z.enum(['tool_start', 'tool_end']),
    toolName: z.string(),
    toolCallId: z.string(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
  })
  ```
- [x] Define `executorEventSchema` as a discriminated or structural union:
  ```
  z.object({
    payload: taskToolProgressSchema.optional(),
    type: z.string().optional(),
    // ...other fields the event carries
  }).passthrough()
  ```
- [x] Replace `event as Record` / `payload as Record` with schema validation
- [x] Use `safeParse` here since events arrive rapidly — log and skip malformed events

### 2.3 — Tool input parsing (`src/main/orchestration/service.ts:498-505`)

- [x] Replace `chunk.input as Record<string, unknown>` with:
  ```
  const toolInputSchema = z.record(z.string(), z.unknown())
  const toolInput = toolInputSchema.safeParse(chunk.input)
  ```
- [x] Replace `JSON.parse(argsStr) as Record` with `parseJsonSafe(argsStr, toolInputSchema)`

---

## Phase 3 — HIGH priority: Streaming & error boundaries (items #1-2, #12-16)

### 3.1 — OpenRouter adapter cast (`src/main/providers/openrouter.ts:36`)

**Pattern**: `as unknown as AnyTextAdapter` double cast
- [x] Investigate TanStack `createOpenRouterText` return type
- [x] If the type is structurally compatible, use a generic wrapper or satisfies check
- [x] If TanStack types truly don't align, add a branded type adapter with a single documented `// SAFETY:` comment and a runtime assertion, or extract a thin adapter that maps the return type correctly
- [x] This may be the one case where a strategic assertion is acceptable if TanStack's generics prevent structural compliance — document why

### 3.2 — IPC fallback proxy (`src/renderer/src/lib/ipc.ts:26`)

**Pattern**: `as unknown as OpenHiveApi`
- [x] Create a typed proxy factory that implements `OpenHiveApi` interface:
  ```
  function createFallbackApi(): OpenHiveApi {
    const handler: ProxyHandler<object> = {
      get: (_, prop) => (...args) => { console.warn(...); return Promise.resolve(undefined) }
    }
    return new Proxy({} as OpenHiveApi, handler)
    // Note: Proxy itself requires the cast — but we can validate the contract with a satisfies check
  }
  ```
- [x] Alternative: if all methods are known, create an explicit no-op implementation object typed as `OpenHiveApi`

### 3.3 — Feature registry error parse (`src/main/agent/feature-registry.ts:115`)

- [x] Define `errorResultSchema` (may already exist from previous streaming work — check `src/main/agent/`):
  ```
  z.object({
    error: z.unknown().optional(),
    message: z.unknown().optional(),
    text: z.unknown().optional(),
  })
  ```
- [x] Replace `parsed as { error?; message?; text? }` with `errorResultSchema.safeParse(parsed)`

### 3.4 — Stream bridge error narrowing (`src/main/utils/stream-bridge.ts:20-21`)

- [x] Define `streamErrorSchema`:
  ```
  z.object({
    message: z.string(),
    name: z.string().optional(),
    stack: z.string().optional(),
    code: z.string().optional(),
  })
  ```
- [x] Replace `chunk.error as { name? }` / `as { stack? }` with:
  ```
  const parsed = streamErrorSchema.safeParse(chunk.error)
  ```
  Use `parsed.data` fields directly

### 3.5 — Git exec error shape (`src/main/ipc/git/shared.ts:39-44`)

- [x] Define `execErrorSchema`:
  ```
  z.object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    code: z.union([z.number(), z.string()]).optional(),
    message: z.string().optional(),
  })
  ```
- [x] Replace `err as { stdout?; stderr?; code?; message? }` with `execErrorSchema.safeParse(err)`
- [x] Fallback: if parse fails, return generic error result

### 3.6 — Define tool already-valid cast (`src/main/tools/define-tool.ts:78`)

- [x] Line 78 is `const parsed: z.infer<T> = config.inputSchema.parse(args)` — this is already Zod-validated
- [x] Verify the type annotation is redundant (it should be, since `.parse()` returns `z.infer<T>`)
- [x] If there's an actual `as` cast, remove it; if it's just a type annotation, leave it (annotations are not casts)

### 3.7 — IPC connection adapter error (`src/renderer/src/lib/ipc-connection-adapter.ts:194`)

- [x] `payload.chunk.error` should already carry the `AgentStreamEvent` discriminated type from `src/shared/types/`
- [x] Define `runErrorPayloadSchema`:
  ```
  z.object({ message: z.string(), code: z.string().optional() })
  ```
- [x] Replace `payload.chunk.error as { message; code? }` with schema validation
- [x] Use `AgentErrorCode` type guard (`code in ERROR_CODE_META`) for downstream classification

---

## Phase 4 — HIGH priority: Renderer-side casts (items #17-20)

### 4.1 — Tool args JSON parse (`src/renderer/src/lib/tool-args.ts:7`)

- [x] Replace `JSON.parse(args) as Record<string, unknown>` with:
  ```
  z.record(z.string(), z.unknown()).parse(JSON.parse(args))
  ```
  Or use `parseJson(args, z.record(z.string(), z.unknown()))`

### 4.2 — AskUser result payload (`src/renderer/src/components/chat/AskUserBlock.tsx:37,40`)

- [x] Define `askUserResultSchema`:
  ```
  z.object({
    kind: z.string().optional(),
    data: z.object({
      answers: z.array(z.object({
        question: z.string(),
        selectedOption: z.string(),
      }))
    }).optional(),
  })
  ```
- [x] Consider placing in `src/shared/types/question.ts` next to existing question schemas
- [x] Replace both casts with `askUserResultSchema.safeParse(parsed)`

### 4.3 — CodeBlock + StreamingText React element casts (items #19, #20)

- [x] Use the shared `isReactElementWithProps` guard from Phase 0.2
- [x] `CodeBlock.tsx:21`: Replace `node as ReactElement<{ children?: ReactNode }>` with guard
- [x] `StreamingText.tsx:18`: Replace `children as ReactElement<{ className?: string }>` with guard

---

## Phase 5 — MEDIUM priority: Manual narrowing patterns (items #21-26)

### 5.1 — ENOENT error checks (items #21-23)

- [x] `agents-resolver.ts:226-229`: Replace `isMissingError()` body with `isEnoent()` from Phase 0.1
- [x] `skill-catalog.ts:286-289`: Same replacement
- [x] `conversations.ts:258`: Replace inline guard with `isEnoent(err)`
- [x] Remove local `isMissingError` functions after replacement

### 5.2 — Ollama API response (`src/main/providers/ollama.ts:20`)

- [x] Define `ollamaModelsResponseSchema`:
  ```
  z.object({
    models: z.array(z.object({ name: z.string() })).optional(),
  })
  ```
- [x] Replace `(await response.json()) as { models? }` with `ollamaModelsResponseSchema.parse(await response.json())`

### 5.3 — Terminal handler env cast (`src/main/ipc/terminal-handler.ts:58`)

- [x] `getSafeChildEnv()` already validates — check its return type
- [x] If return type is `Record<string, string | undefined>`, filter out `undefined` values before passing to pty:
  ```
  Object.fromEntries(Object.entries(childEnv).filter((entry): entry is [string, string] => entry[1] !== undefined))
  ```
- [x] This eliminates the `as Record<string, string>` cast structurally

### 5.4 — TanStack AI Devtools window cast (`src/renderer/src/components/devtools/TanStackAIDevtools.tsx:18`)

- [x] Use the global `window.api` accessor from `src/renderer/src/lib/ipc.ts` instead of manual cast
- [x] If devtools needs to check availability before `ipc.ts` loads, use:
  ```
  'api' in window ? window.api : null
  ```
  with a module augmentation declaring `api` on `Window`

---

## Phase 6 — Verification & cleanup

### 6.1 — Grep for remaining casts
- [x] Run `grep -rn ' as ' src/ --include='*.ts' --include='*.tsx'` and verify zero unsafe casts remain
- [x] Allowlist: `as const`, `as readonly`, satisfies patterns, and the documented OpenRouter adapter (if kept)

### 6.2 — Typecheck
- [x] `pnpm typecheck` passes with zero errors

### 6.3 — Test suite
- [x] `pnpm test` — all existing tests pass
- [x] Add unit tests for new shared utilities:
  - `isNodeError` / `isEnoent` — test with Error, ErrnoException, non-object, null
  - `parseJson` / `parseJsonSafe` — test valid JSON, invalid JSON, schema mismatch
  - `isReactElementWithProps` — test with ReactElement, string, null, array
- [x] Add unit tests for new Zod schemas:
  - `projectConfigSchema` — valid TOML output, missing fields, extra fields
  - `packageJsonSchema` — real package.json, minimal, empty
  - `orchestrationRunRecordSchema` — valid record, corrupted fields
  - `persistedRunIndexSchema` — valid index, empty

### 6.4 — Biome lint
- [x] `pnpm lint` passes

---

## Execution order & dependencies

```
Phase 0 (foundations) ──┬── Phase 1 (persistence/config)
                        ├── Phase 2 (orchestration)
                        ├── Phase 3 (streaming/errors)
                        ├── Phase 4 (renderer)
                        └── Phase 5 (medium priority)
                                    │
                                    v
                              Phase 6 (verification)
```

Phases 1-5 are independent of each other and can be worked in any order after Phase 0. Phase 6 runs last.

## Files created/modified

**New files (3)**:
- `src/shared/utils/node-error.ts`
- `src/shared/utils/parse-json.ts`
- `src/renderer/src/lib/react-element-guard.ts`

**Modified files (20)**:
- `src/main/store/settings.ts`
- `src/main/config/project-config.ts`
- `src/main/orchestration/project-context.ts`
- `src/main/orchestration/run-repository.ts`
- `src/main/orchestration/service.ts`
- `src/main/agent/feature-registry.ts`
- `src/main/utils/stream-bridge.ts`
- `src/main/ipc/git/shared.ts`
- `src/main/tools/define-tool.ts`
- `src/main/providers/openrouter.ts`
- `src/main/providers/ollama.ts`
- `src/main/standards/agents-resolver.ts`
- `src/main/skills/skill-catalog.ts`
- `src/main/store/conversations.ts`
- `src/main/ipc/terminal-handler.ts`
- `src/renderer/src/lib/ipc.ts`
- `src/renderer/src/lib/ipc-connection-adapter.ts`
- `src/renderer/src/lib/tool-args.ts`
- `src/renderer/src/components/chat/AskUserBlock.tsx`
- `src/renderer/src/components/chat/CodeBlock.tsx`
- `src/renderer/src/components/chat/StreamingText.tsx`
- `src/renderer/src/components/devtools/TanStackAIDevtools.tsx`
- `src/shared/types/orchestration.ts` (add Zod schemas alongside interfaces)

**New test files (3)**:
- `src/shared/utils/node-error.unit.test.ts`
- `src/shared/utils/parse-json.unit.test.ts`
- `src/renderer/src/lib/react-element-guard.unit.test.ts`

## Risk notes

- **Phase 3.1 (OpenRouter)**: Resolved — both casts removed; `includes()` guard narrows the model type and the return type is structurally compatible.
- **Phase 3.2 (IPC proxy)**: `Object.create(null)` returns `any` which satisfies `Proxy<T>` — inherent limitation of proxying interfaces, documented in comment.
- **Phase 2.2 (executor events)**: Uses `safeParse` as planned.
- **Phase 1.4 (run repository)**: Schemas placed in `src/shared/schemas/validation.ts` (separate from type interfaces).

## Remaining boundary casts (documented exceptions)

- `typed-ipc.ts`: `handler as Parameters<typeof ipcMain.handle>[1]` — Electron IPC boundary, args arrive as `any[]`.
- `includes()` internal: `(arr as readonly string[]).includes(value)` — contained inside the utility, callers see only the type predicate.
- `ipc.ts` Proxy: `Object.create(null)` returns `any` — inherent Proxy limitation.

## Status: DONE (2026-02-24)
