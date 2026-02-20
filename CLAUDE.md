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

### Testing

```bash
pnpm test               # All tests (unit + integration + packages)
pnpm test:unit           # Unit tests only (*.unit.test.ts)
pnpm test:integration    # Integration tests only (*.integration.test.ts)
pnpm test:packages       # condukt-ai + condukt-openhive
pnpm test:e2e            # Playwright E2E (requires build)
pnpm test:coverage       # Coverage report (v8)
```

## ⛔ MANDATORY RULES — READ BEFORE DOING ANYTHING

These rules are **non-negotiable**. Violating them invalidates your work.

### Knowledge Transfer (MUST FOLLOW)

**Before starting ANY task:**

1. Read `LEARNINGS.md` sections 1-3 (skip Archive)
2. Note any warnings relevant to your task
3. Read `docs/product/ui-interaction-prd.md` and check whether the task maps to any planned/future UI feature (`HC-UI-*` items)
4. If task is related, explicitly align implementation decisions with that PRD/spec and update the same document when scope/behavior changes

**After completing ANY task:**

1. Add learnings to "Recent Learnings" only when they are high-signal technical findings (implementation, integration, architecture, debugging patterns, or non-obvious framework/tool constraints)
2. Do NOT add routine project-management notes (e.g. missing docs/backlog file, branch names, generic process updates) unless they materially affect implementation behavior
3. If there is no significant technical learning, add nothing for that task
4. If a learning is significant, mark it with `[SKILL?]`
5. If any section exceeds its cap, consolidate or archive oldest items
6. If YOUR task's learning is marked `[SKILL?]`, ask user: *"This seems significant — should I create a skill for [X]?"*

### Git Workflow (MUST FOLLOW)

**During implementation:**

- Before starting implementation, create a branch using `<type>/<task-slug>`.
- Allowed branch/commit types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Do not commit any changes until the maintainer explicitly approves committing.
- Keep changes on the branch for local user review first.
- Before the first commit, explicitly tell the user: `Changes are ready for review on <type>/<task-slug>.`
- Pause and wait for explicit approval before creating any commit.
- After approval to commit, create atomic commits per logical unit of work.
- Format: `<type>(<scope>): <description>`
- After approved commits are complete, merge the working branch into local `main`.
- Push the updated `main` branch to `origin`.

## Definition of Done

1. Scope is met with no unapproved side-effects.
2. Tests added/updated for behavior changes.
3. Required verification passed for task class.
4. Docs updated if behavior, workflow, or developer expectations changed.
5. Significant learnings appended to `LEARNINGS.md` (**if there is any significant learning to add**).
6. Changes are grouped into logical commits.

## Architecture

OpenHive is an Electron desktop coding agent with multi-model LLM support. Three process targets share types through `src/shared/`.

### Process Boundaries

- **Main** (`src/main/`) — Node.js. Agent loop, tool execution, persistence, IPC handlers. Built by `electron-vite` as CJS with ESM interop.
- **Preload** (`src/preload/`) — Bridge. Exposes typed `api` object via `contextBridge`. Every method maps to a specific IPC channel.
- **Renderer** (`src/renderer/src/`) — React 19 + Zustand + Tailwind v4. State in two Zustand stores: `chat-store.ts` (conversations, streaming) and `settings-store.ts` (API keys, model selection).

### IPC Type System

`src/shared/types/ipc.ts` is the single source of truth. Three channel maps define all IPC:
- `IpcInvokeChannelMap` — request/response (renderer invokes, main responds)
- `IpcSendChannelMap` — fire-and-forget (renderer → main)
- `IpcEventChannelMap` — events (main → renderer)

The preload `api` object (`src/preload/api.ts`) implements `OpenHiveApi` — a convenience wrapper that maps friendly method names to IPC channels. The renderer imports this as `window.api` via `src/renderer/src/lib/ipc.ts`.

### Provider Registry

`src/main/providers/` implements a dynamic multi-provider system. `ProviderDefinition` (interface) defines each provider's capabilities. `ProviderRegistry` (singleton) manages registration and lookup:
- 6 providers: Anthropic, OpenAI, Gemini, Grok, OpenRouter, Ollama
- Each provider file exports a `ProviderDefinition` with model list, adapter factory, and capabilities
- `registerAllProviders()` called at app startup before IPC handlers
- Registry provides `getProviderForModel(id)` for model→provider resolution and `createAdapter()` for chat adapter creation
- `providers:get-models` IPC channel exposes grouped model lists to the renderer

### Agent Loop

`src/main/agent/agent-loop.ts` uses TanStack AI's `chat()` function with the provider registry to dynamically create adapters. The loop:
1. Converts our `Message[]` to `SimpleChatMessage[]` (structural typing to avoid `ConstrainedModelMessage` generics)
2. Resolves the provider via `providerRegistry.getProviderForModel()` and creates an adapter with the provider's `createAdapter()` method
3. Iterates the `AsyncIterable<StreamChunk>` stream, translating AG-UI events (`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_*`, `RUN_ERROR`) into our `AgentStreamEvent` discriminated union
4. Emits events over IPC via `emitAgentEvent()` (broadcasts to all renderer windows)

Tools are executed by TanStack AI internally during the stream — results arrive via `TOOL_CALL_END.result`.

### Tool System

`src/main/tools/define-tool.ts` wraps TanStack AI's `toolDefinition().server()`. Each tool:
- Declares a Zod schema for args (validated at runtime via `.parse()`)
- Uses `z.infer<T>` for type-safe execute function (not TanStack's `InferSchemaType` which returns `unknown` for Zod)
- Accesses `ToolContext` (projectPath, AbortSignal) via module-level getter — safe because agent runs are sequential

Built-in tools in `src/main/tools/tools/`: `readFile`, `writeFile`, `editFile`, `runCommand`, `glob`, `listFiles`, `loadSkill`, `askUser`. Write/edit/command require approval (`needsApproval: true`).

### Persistence

- **Settings**: `electron-store` (key-value in OS config dir)
- **Conversations**: JSON files in `{userData}/conversations/{id}.json` with Zod schema validation on load. Includes model ID migration for backward compatibility (`LEGACY_MODEL_MAP`).

### Model System

`SupportedModelId` is a `string` type alias — runtime validation is done via the provider registry's `isKnownModel()`. Each provider package exports its own model tuple (e.g. `ANTHROPIC_MODELS`, `OPENAI_CHAT_MODELS`, `GeminiTextModels`). The model selector in the renderer fetches grouped model lists dynamically via `providers:get-models` IPC. `generateDisplayName()` converts model IDs to human-readable names.

## Key Patterns

- **Branded types** (`src/shared/types/brand.ts`): `ConversationId`, `MessageId`, `ToolCallId` prevent accidental ID mixing. Use constructors at boundaries: `ConversationId(uuid())`.
- **Discriminated unions**: Message parts (`type: 'text' | 'tool-call' | 'tool-result'`), agent events (`type: 'text-delta' | 'tool-call-start' | ...`), stream chunks.
- **Path aliases**: `@shared/*` → `src/shared/*` (all targets), `@/*` → `src/renderer/src/*` (renderer only).
- **Provider registry**: `providerRegistry` singleton resolves models to providers at runtime. Each provider implements `ProviderDefinition` with `createAdapter()` for chat adapter creation.

## Electron-Vite Config

`electron.vite.config.ts` has two important settings:
- `externalizeDeps.exclude` includes all `@tanstack/ai-*` packages (anthropic, openai, gemini, grok, openrouter, ollama) — ESM-only, must be bundled into main process output
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
- **Never use `process.env` or `import.meta.env`** — import from `./env` in main process (`src/main/env.ts`) or `@/env` in renderer (`src/renderer/src/env.ts`). Biome enforces `noProcessEnv`; only `src/main/env.ts` has an override.
- **Always use `cn()`** from `src/lib/utils` for conditional Tailwind classes.
- **Never use raw `console.*` in main process code** — use the structured logger from `src/main/logger.ts`. Create a module-level instance with `const logger = createLogger('<namespace>')` and call `logger.info(message, data?)`. The logger auto-formats output as `[namespace] message {data}`. Pass structured data as the second argument instead of `JSON.stringify()` wrappers.

## Skills Standard

- Project-local skills live under `.openhive/skills/<skill-id>/`.
- Each skill folder must contain a `SKILL.md` file.
- Optional bundled resources (for example `scripts/`) should remain inside the same skill folder.
- Runtime skill discovery is folder-based only (no `SKILLS.md` catalog file).
- Prompt behavior is metadata-first: skills are discovered by frontmatter (`name`, `description`) and activated by explicit refs/heuristics.
- Full skill instructions are loaded only for selected skills or when the agent calls `loadSkill` mid-run.
- Dynamic `loadSkill` activation is run-scoped; it does not auto-persist across turns.
