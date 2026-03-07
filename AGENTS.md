# AGENTS.md

This file provides guidance to Agents when working with code in this repository.

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
pnpm check:fast       # typecheck + lint only (faster local loop)
pnpm check            # typecheck + lint combined
pnpm test:e2e         # Playwright E2E in headless mode (agent/default path)
pnpm test:e2e:headless # Explicit headless E2E alias
pnpm test:e2e:headless:quick # Reuse the current build; skips pnpm build
pnpm test:e2e:headed  # Manual local headed E2E debug run
pnpm test:e2e:headed:quick # Reuse the current build in headed mode
pnpm build:mac        # Build macOS dmg
pnpm build:win        # Build Windows NSIS installer
pnpm build:linux      # Build Linux AppImage
```

Automated tests are configured with Vitest (`pnpm test`). Manual QA via `pnpm dev` is still required for renderer behavior.

For fast local verification, prefer `pnpm check:fast` while iterating and use the `*:quick` E2E scripts only when you know the app is already built and up to date.

E2E policy: agent workflows must use headless E2E (`pnpm test:e2e` / `pnpm test:e2e:headless`). Manual local debugging can use `pnpm test:e2e:headed`.

## ⛔ MANDATORY RULES — READ BEFORE DOING ANYTHING

These rules are **non-negotiable**. Violating them invalidates your work.

### Knowledge Transfer (MUST FOLLOW)

**Before starting ANY task:**

1. Read `tasks/learnings.md` sections 1-3 (skip Archive) and review `tasks/lessons.md` for user corrections
2. Note any warnings relevant to your task
3. Read `docs/product/ui-interaction-prd.md` and check whether the task maps to any planned/future UI feature (`HC-UI-*` items)
4. If task is related, explicitly align implementation decisions with that PRD/spec and update the same document when scope/behavior changes

**After completing ANY task:**

1. Add learnings to `tasks/learnings.md` "Recent Learnings" when they are high-signal technical findings (implementation, integration, architecture, debugging patterns, or non-obvious framework/tool constraints)
2. Do NOT add routine project-management notes (e.g. missing docs/backlog file, branch names, generic process updates) unless they materially affect implementation behavior
3. If there is no significant technical learning, add nothing to `tasks/learnings.md` for that task
4. If a learning is significant, mark it with `[SKILL?]`
5. If any section exceeds its cap, consolidate or archive oldest items
6. If YOUR task's learning is marked `[SKILL?]`, ask user: *"This seems significant — should I create a skill for [X]?"*

**Two knowledge files — different purposes:**

- **`tasks/learnings.md`** — Technical findings discovered during implementation (architecture patterns, framework quirks, integration gotchas). Written by the agent autonomously.
- **`tasks/lessons.md`** — User corrections and behavioral rules. Updated whenever the user corrects you. These are patterns to never repeat.

### Git Workflow (MUST FOLLOW)

**During implementation:**

- Before starting implementation, create a branch using `<type>/<task-slug>`.
- Allowed branch/commit types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Fix bugs, implement features, and resolve issues autonomously — don't ask the user for guidance during implementation.
- Do not commit any changes until the maintainer explicitly approves. Code freely, commit only with permission.
- Before the first commit, explicitly tell the user: `Changes are ready for review on <type>/<task-slug>.`
- Pause and wait for explicit approval before creating any commit.
- After approval to commit, create atomic commits per logical unit of work.
- Commit message format: `<type>(<scope>): <description>`
- After approved commits are complete, merge the working branch into local `main`.
- Push the updated `main` branch to `origin`.

## Definition of Done

1. Scope is met with no unapproved side-effects.
2. Tests added/updated for behavior changes.
3. Verified: tests pass, logs are clean, behavior matches intent. Ask yourself: "Would a staff engineer approve this?"
4. If renderer code (`src/renderer/`) was touched: run React Doctor diagnostics (`npx -y react-doctor@latest . --verbose --diff main`), fix all errors, verify score did not drop. Consult the `react-doctor` skill in `.openwaggle/skills/react-doctor/` for fix patterns.
5. Docs updated if behavior, workflow, or developer expectations changed.
6. Significant learnings appended to `tasks/learnings.md` (**if there is any significant learning to add**).
7. Changes are grouped into logical commits.
8. If you encounter a new TanStack AI bug, unexpected behavior, or workaround requirement (in `@tanstack/ai`, `@tanstack/ai-client`, or `@tanstack/ai-react`), explicitly report it to the user with a clear description. Reference `docs/tanstack-ai-known-issues.md` for existing issues and add new findings there. The maintainers are actively responsive — new bugs may be reportable upstream.

## Architecture

OpenWaggle is an Electron desktop coding agent with multi-model LLM support. Three process targets share types through `src/shared/`.

### Process Boundaries

- **Main** (`src/main/`) — Node.js. Agent loop, tool execution, persistence, IPC handlers. Built by `electron-vite` as CJS with ESM interop.
- **Preload** (`src/preload/`) — Bridge. Exposes typed `api` object via `contextBridge`. Every method maps to a specific IPC channel.
- **Renderer** (`src/renderer/src/`) — React 19 + Zustand + Tailwind v4. State in two Zustand stores: `chat-store.ts` (conversations, streaming) and `settings-store.ts` (API keys, model selection).

### IPC Type System

`src/shared/types/ipc.ts` is the single source of truth. Three channel maps define all IPC:
- `IpcInvokeChannelMap` — request/response (renderer invokes, main responds)
- `IpcSendChannelMap` — fire-and-forget (renderer → main)
- `IpcEventChannelMap` — events (main → renderer)

The preload `api` object (`src/preload/api.ts`) implements `OpenWaggleApi` — a convenience wrapper that maps friendly method names to IPC channels. The renderer imports this as `window.api` via `src/renderer/src/lib/ipc.ts`.

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

## Security

- Canonical security posture is documented in both this file and `CLAUDE.md`; keep them synchronized.
- Renderer `BrowserWindow` defaults are fail-closed and asserted at runtime via `src/main/security/electron-security.ts`.
- Required `webPreferences` posture:
  - `nodeIntegration: false`
  - `contextIsolation: true`
  - `sandbox: true`
  - `webSecurity: true`
  - `allowRunningInsecureContent: false`
- CSP is enforced in two layers:
  - Main process response-header enforcement (`session.webRequest.onHeadersReceived`)
  - Renderer meta tag in `src/renderer/index.html`
- CSP baseline:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data:`
  - `connect-src 'self' ws://localhost:* http://localhost:* https://localhost:* wss://localhost:*`

## Performance

### React Compiler

`babel-plugin-react-compiler` is configured in `electron.vite.config.ts`. It auto-memoizes component renders, so:
- **Never use `React.memo()`** — the compiler handles it.
- **Never use `useMemo()` / `useCallback()` for render optimization** — the compiler handles it. Only use them for referential identity needed by external APIs (e.g. `useEffect` deps that must be stable for non-render reasons).

### Streaming Rendering

`StreamingText` always renders through `ReactMarkdown` + `remarkGfm`, including during streaming. There is no plain-text fallback or throttle — ReactMarkdown handles token-by-token updates fine at typical LLM streaming rates.

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
- **Never introduce inline numeric literals (magic numbers)** — extract them into descriptive `SCREAMING_SNAKE_CASE` constants (module-local by default, shared constants only when reused across modules). Validate with `pnpm check:magic-numbers` before handoff.

## Skills Standard

- Project-local skills live under `.openwaggle/skills/<skill-id>/`.
- Each skill folder must contain a `SKILL.md` file.
- Optional bundled resources (for example `scripts/`) should remain inside the same skill folder.
- Runtime skill discovery is folder-based only (no `SKILLS.md` catalog file).
- Prompt behavior is metadata-first: skills are discovered by frontmatter (`name`, `description`) and activated by explicit refs/heuristics.
- Full skill instructions are loaded only for selected skills or when the agent calls `loadSkill` mid-run.
- Dynamic `loadSkill` activation is run-scoped; it does not auto-persist across turns.

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Demand Simplicity
- Simple and correct first. Elegant only when it reduces complexity.
- If a fix feels hacky: "Knowing everything I know now, implement the clean solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 5. Autonomous Bug Fixing
- When given a bug report: fix it autonomously. Don't ask for guidance during the fix.
- Point at logs, errors, failing tests — then resolve them
- Present the fix for review when done (commit approval still required per Git Workflow)
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/specs/<task-name>.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/specs/<task-name>.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after user corrections; update `tasks/learnings.md` for technical findings

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
