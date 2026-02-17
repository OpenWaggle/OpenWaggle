# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start Electron app in dev mode (hot-reloads renderer only; main process needs full restart)
pnpm build            # Production build
pnpm typecheck        # Full type check (runs typecheck:node + typecheck:web)
pnpm typecheck:node   # Type check main + preload + shared (tsconfig.node.json)
pnpm typecheck:web    # Type check renderer + shared (tsconfig.web.json)
pnpm lint             # Biome lint check
pnpm lint:fix         # Biome lint + auto-fix
pnpm format           # Biome format
pnpm check            # typecheck + lint combined
pnpm build:mac        # Build macOS dmg
pnpm build:win        # Build Windows NSIS installer
pnpm build:linux      # Build Linux AppImage
```

No test framework is configured. All testing is manual via `pnpm dev`.

## Architecture

HiveCode is an Electron desktop coding agent with multi-model LLM support. Three process targets share types through `src/shared/`.

### Process Boundaries

- **Main** (`src/main/`) — Node.js. Agent loop, tool execution, persistence, IPC handlers. Built by `electron-vite` as CJS with ESM interop.
- **Preload** (`src/preload/`) — Bridge. Exposes typed `api` object via `contextBridge`. Every method maps to a specific IPC channel.
- **Renderer** (`src/renderer/src/`) — React 19 + Zustand + Tailwind v4. State in two Zustand stores: `chat-store.ts` (conversations, streaming) and `settings-store.ts` (API keys, model selection).

### IPC Type System

`src/shared/types/ipc.ts` is the single source of truth. Three channel maps define all IPC:
- `IpcInvokeChannelMap` — request/response (renderer invokes, main responds)
- `IpcSendChannelMap` — fire-and-forget (renderer → main)
- `IpcEventChannelMap` — events (main → renderer)

The preload `api` object (`src/preload/api.ts`) implements `HiveCodeApi` — a convenience wrapper that maps friendly method names to IPC channels. The renderer imports this as `window.api` via `src/renderer/src/lib/ipc.ts`.

### Agent Loop

`src/main/agent/agent-loop.ts` uses TanStack AI's `chat()` function with provider-specific adapters (`createAnthropicChat`, `createOpenaiChat`). The loop:
1. Converts our `Message[]` to `SimpleChatMessage[]` (structural typing to avoid `ConstrainedModelMessage` generics)
2. Dispatches to provider-specific functions (`runAnthropicChat`/`runOpenaiChat`) for full type inference — no `as any` casts
3. Iterates the `AsyncIterable<StreamChunk>` stream, translating AG-UI events (`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_*`, `RUN_ERROR`) into our `AgentStreamEvent` discriminated union
4. Emits events over IPC via `emitAgentEvent()` (broadcasts to all renderer windows)

Tools are executed by TanStack AI internally during the stream — results arrive via `TOOL_CALL_END.result`.

### Tool System

`src/main/tools/define-tool.ts` wraps TanStack AI's `toolDefinition().server()`. Each tool:
- Declares a Zod schema for args (validated at runtime via `.parse()`)
- Uses `z.infer<T>` for type-safe execute function (not TanStack's `InferSchemaType` which returns `unknown` for Zod)
- Accesses `ToolContext` (projectPath, AbortSignal) via module-level getter — safe because agent runs are sequential

Six built-in tools in `src/main/tools/tools/`: `readFile`, `writeFile`, `editFile`, `runCommand`, `glob`, `listFiles`. Write/edit/command require approval (`needsApproval: true`).

### Persistence

- **Settings**: `electron-store` (key-value in OS config dir)
- **Conversations**: JSON files in `{userData}/conversations/{id}.json` with Zod schema validation on load. Includes model ID migration for backward compatibility (`LEGACY_MODEL_MAP`).

### Model System

`src/shared/types/llm.ts` derives `SupportedModelId` from TanStack AI's const tuples (`ANTHROPIC_MODELS`, `OPENAI_CHAT_MODELS`). Model IDs are compile-time validated — no branded type, just a literal union. `UI_MODELS` is a curated subset with `satisfies readonly SupportedModelId[]`.

## Key Patterns

- **Branded types** (`src/shared/types/brand.ts`): `ConversationId`, `MessageId`, `ToolCallId` prevent accidental ID mixing. Use constructors at boundaries: `ConversationId(uuid())`.
- **Discriminated unions**: Message parts (`type: 'text' | 'tool-call' | 'tool-result'`), agent events (`type: 'text-delta' | 'tool-call-start' | ...`), stream chunks.
- **Path aliases**: `@shared/*` → `src/shared/*` (all targets), `@/*` → `src/renderer/src/*` (renderer only).
- **Provider narrowing**: `isAnthropicModel()` type predicate narrows `SupportedModelId` to `AnthropicChatModel`, enabling separate provider-specific chat functions with full type inference.

## Electron-Vite Config

`electron.vite.config.ts` has two important settings:
- `externalizeDepsPlugin({ exclude: ['@tanstack/ai', '@tanstack/ai-anthropic', '@tanstack/ai-openai'] })` — TanStack packages are ESM-only, must be bundled into main process output
- `build.rollupOptions.output.interop: 'auto'` — Required for CJS interop with ESM-only externals like `electron-store`

## Performance

### React Compiler

`babel-plugin-react-compiler` is configured in `electron.vite.config.ts`. It auto-memoizes component renders, so:
- **Never use `React.memo()`** — the compiler handles it.
- **Never use `useMemo()` / `useCallback()` for render optimization** — the compiler handles it. Only use them for referential identity needed by external APIs (e.g. `useEffect` deps that must be stable for non-render reasons).

### Streaming Rendering

`StreamingText` accepts an `isStreaming` prop. When `true`, it renders plain text instead of running `ReactMarkdown` + `remarkGfm`. This avoids re-parsing markdown on every streaming token. Only pass `isStreaming` for the actively-accumulating text; completed text blocks and historical messages render full markdown.

### Zustand Selectors

Always use granular selectors with `useChatStore((s) => s.field)` — never call `useChatStore()` without a selector. Streaming state (`streamingText`, `streamingParts`, `status`) is subscribed to directly in `ChatPanel`, not passed down from `App.tsx`, so streaming tokens don't re-render the entire component tree.

## Coding Conventions

- **Always use `pnpm`** to run scripts, tests, or manage dependencies. Never use `npm` or `yarn`.
- **Never use `any`** — prefer `unknown` plus narrowing, or Zod schemas for runtime validation.
- **Never use `React.FC`** — define components as plain functions with explicit props interfaces.
- **Never use `forwardRef`** — React 19 supports direct ref props.
- **Never mutate Zustand state directly** — always use store actions.
- **Never use `process.env` or `import.meta.env`** — import from `@/env` (Biome enforces `noProcessEnv`). # TODO: this file needs to be created
- **Always use `cn()`** from `src/lib/utils` for conditional Tailwind classes.
