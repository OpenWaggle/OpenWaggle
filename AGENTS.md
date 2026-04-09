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
pnpm check            # typecheck + lint combined
pnpm dev:debug        # Start Electron with CDP on port 9222 (for MCP QA testing)
pnpm build:mac        # Build macOS dmg
pnpm build:win        # Build Windows NSIS installer
pnpm build:linux      # Build Linux AppImage
```

### Testing

```bash
pnpm test               # All tests (unit + integration + component)
pnpm test:unit           # Unit tests only (*.unit.test.ts)
pnpm test:integration    # Integration tests only (*.integration.test.ts)
pnpm test:component      # Component tests (*.component.test.tsx)
pnpm test:e2e            # Playwright E2E (requires build)
pnpm test:coverage       # Coverage report (v8)
```

## ⛔ MANDATORY RULES — READ BEFORE DOING ANYTHING

These rules are **non-negotiable**. Violating them invalidates your work.

### Knowledge Transfer (MUST FOLLOW)

**Before starting ANY task:**

1. Read `docs/learnings.md` sections 1-3 (skip Archive) and review `docs/lessons.md` for user corrections
2. Note any warnings relevant to your task
3. If the task is linked to a GitHub Issue, read the issue for scope and acceptance criteria

**After completing ANY task:**

1. Add learnings to `docs/learnings.md` "Recent Learnings" when they are high-signal technical findings (implementation, integration, architecture, debugging patterns, or non-obvious framework/tool constraints)
2. Do NOT add routine project-management notes (e.g. missing docs/backlog file, branch names, generic process updates) unless they materially affect implementation behavior
3. If there is no significant technical learning, add nothing to `docs/learnings.md` for that task
4. If a learning is significant, mark it with `[SKILL?]`
5. If any section exceeds its cap, consolidate or archive oldest items
6. If YOUR task's learning is marked `[SKILL?]`, ask user: *"This seems significant — should I create a skill for [X]?"*

**Two knowledge files — different purposes:**

- **`docs/learnings.md`** — Technical findings discovered during implementation (architecture patterns, framework quirks, integration gotchas). Written by the agent autonomously.
- **`docs/lessons.md`** — User corrections and behavioral rules. Updated whenever the user corrects you. These are patterns to never repeat.

### Git Workflow (MUST FOLLOW)

**During implementation:**

- Before starting implementation, create a branch:
  - For issue-linked work: `<type>/<issue-number>-<slug>` (e.g., `feat/42-token-tracking`)
  - For non-issue work: `<type>/<slug>` (e.g., `refactor/cleanup-imports`)
- Allowed branch/commit types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Fix bugs, implement features, and resolve issues autonomously — don't ask the user for guidance during implementation.
- Do not commit any changes until the maintainer explicitly approves. Code freely, commit only with permission.
- Before the first commit, explicitly tell the user: `Changes are ready for review on <branch-name>.`
- Pause and wait for explicit approval before creating any commit.
- After approval to commit, create atomic commits per logical unit of work.
- Format: `<type>(<scope>): <description>`
- After approved commits are complete, push the working branch to `origin`.
- Create a PR linked to the issue:
  - If fully solving the issue: use `Closes #<issue-number>` in the PR body
  - If partial progress: use `Part of #<issue-number>` in the PR body and update the issue with progress notes
- After PR merge: update the issue status and GitHub Project roadmap if applicable.

## Definition of Done

1. Scope is met with no unapproved side-effects.
2. Tests added/updated for behavior changes.
3. Verified: tests pass, logs are clean, behavior matches intent. Ask yourself: "Would a staff engineer approve this?"
4. Verified: the implementation is aligned with the relevant first principles in `docs/principles/`.
5. If renderer code (`src/renderer/`) was touched: run React Doctor diagnostics (`npx -y react-doctor@latest . --verbose --diff main`), fix all errors, verify score did not drop. Load the `react-doctor` skill for fix patterns.
6. If renderer, preload, or IPC code was touched: run Electron QA testing via MCP. Start the app with `pnpm dev:debug`, connect via the `electron-devtools` or `electron-test` MCP servers, and verify the feature works in the real Electron app. Consult the `electron-qa` skill in `.openwaggle/skills/electron-qa/` for procedures and tool reference.
7. Docs updated if behavior, workflow, or developer expectations changed.
8. Significant learnings appended to `docs/learnings.md` (**if there is any significant learning to add**).
9. Changes are grouped into logical commits.
10. PR linked to issue with `Closes #X` or `Part of #X`.
11. Issue and roadmap project updated after merge.
12. If you encounter a new TanStack AI bug, unexpected behavior, or workaround requirement (in `@tanstack/ai`, `@tanstack/ai-client`, or `@tanstack/ai-react`), explicitly report it to the user with a clear description. Reference `docs/tanstack-ai-known-issues.md` for existing issues and add new findings there. The maintainers are actively responsive — new bugs may be reportable upstream.

## Documentation Reference

Read these before making architectural or behavioral decisions:

- `docs/first-principles.md` — First principles. These are the primary foundation for future features, fixes, and product decisions.
- `docs/system-architecture.md` — Current architecture as it exists today.
- `docs/learnings.md` — Technical findings.
- `docs/lessons.md` — User corrections and behavioral rules.

Interpretation rule:

- First principles define what future work must remain faithful to.
- Architecture defines how the system currently exists.
- If current implementation and first principles are in tension, do not blindly copy the current implementation. Resolve the work in a way that stays aligned with the first principles while respecting existing architecture constraints.
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
- Declares an Effect Schema input schema for runtime validation and JSON Schema generation
- Uses `Schema.Type<T>` for type-safe execute functions
- Receives `ToolContext` through explicit per-run binding, not ambient async local state

Built-in tools in `src/main/tools/tools/`: `readFile`, `writeFile`, `editFile`, `runCommand`, `glob`, `listFiles`, `loadSkill`, `askUser`. Write/edit/command require approval (`needsApproval: true`).

### Persistence

- **App-owned state**: SQLite database at `{userData}/openwaggle.db` (settings, auth tokens, conversations, orchestration state, team runtime state)
- **Project-owned state**: `.openwaggle/config.toml` and `.openwaggle/config.local.toml`

### Model System

`SupportedModelId` is a `string` type alias — runtime validation is done via the provider registry's `isKnownModel()`. Each provider package exports its own model tuple (e.g. `ANTHROPIC_MODELS`, `OPENAI_CHAT_MODELS`, `GeminiTextModels`). The model selector in the renderer fetches grouped model lists dynamically via `providers:get-models` IPC. `generateDisplayName()` converts model IDs to human-readable names.

## Engineering Principles

These rules define how code must be written, structured, and evolved.

### Core Engineering Standards

Always apply:

- **SRP (Single Responsibility Principle)** — each module has one responsibility.
- **DRY (Don’t Repeat Yourself)** — eliminate duplication where it provides value.
- **Separation of concerns** — keep domain, infrastructure, and UI clearly separated.
- **Clear boundaries** — no leaking responsibilities across layers.
- **Explicitness over magic** — avoid hidden behavior.

### Architecture Discipline — Hexagonal Architecture (MANDATORY)

This project follows **hexagonal architecture**. Full specification: `docs/hexagonal-architecture.md`.

**Before writing ANY main-process code, you MUST know which layer it belongs to:**

| If you're writing... | It belongs in... | It MUST NOT import... |
|---|---|---|
| Pure business logic | `src/main/domain/` | `@tanstack/ai`, `electron`, `node:fs`, `@effect/sql`, `src/main/store/` |
| A service interface | `src/main/ports/` | `@tanstack/ai`, `src/main/store/` |
| Vendor SDK wrapper | `src/main/adapters/` | (adapters MAY import vendor — this is their job) |
| Business orchestration | `src/main/application/` | `@tanstack/ai`, `src/main/store/` — use `yield*` ports |
| IPC handler | `src/main/ipc/` | `@tanstack/ai`, `src/main/store/` — use `yield*` ports |
| Agent core logic | `src/main/agent/` | `@tanstack/ai` — use domain types only |

**Adding new features:**
1. New persistence → create Port + Adapter + register in `runtime.ts`
2. New business logic → create Application Service using `yield*` ports
3. New IPC channel → handler dispatches to Application Service
4. New vendor integration → create Adapter implementing a Port

**Run `pnpm check:architecture` before committing.** Zero violations tolerated.

- Do not introduce new patterns without strong justification.
- Prefer composition over implicit coupling.
- Keep dependencies directional (inward) and predictable.

### Type Safety (CRITICAL)

Type safety is non-negotiable.

#### Strictly forbidden

- `any`
- type casting
- `as Type`
- angle-bracket casts
- double casting
- unsafe narrowing
- implicit uncertainty hidden behind casting
- "fixing" type errors through assertions instead of proper typing

#### Required

- Prefer type inference
- Explicit validation at boundaries
- Strong typing for all inputs/outputs
- Correct modeling instead of forced assertions

If something cannot be typed correctly, the design must be reconsidered.
If a cast seems necessary, that is a design smell and must be solved at the source.

### Implementation Rules

- Do not implement partial solutions.
- Do not leave unfinished work.
- Do not introduce temporary fixes or hacks.
- Always fix root causes, not symptoms.
- Prefer the simplest correct solution, not the quickest one.

### Boy Scout Rule

Always leave the codebase better than you found it:

- remove obvious dead code
- improve naming clarity
- reduce local duplication
- tighten weak boundaries where safe

Do not perform unrelated large refactors.

### Decision Standard

At every step, validate:

- is this aligned with the first principles?
- does this respect the architecture?
- is this scalable and maintainable?
- is this the simplest correct solution?
- am I solving the problem properly or avoiding it?

### When Facing Complexity

If something feels wrong or overly complex:

- stop and reassess the design
- break the problem down further
- explore alternative approaches
- refine the solution within current architectural constraints

Do not introduce hacks or bypass constraints.

## Principle-Grounded Development

The system is guided by first principles defined in:

- `docs/principles/`

Rules:

- Every feature or fix must be justifiable through one or more principles.
- Do not build features that are not grounded in principles.
- Do not copy patterns blindly from the existing codebase.
- Treat the codebase as an implementation, not the source of truth.

## Key Patterns

- **Branded types** (`src/shared/types/brand.ts`): `ConversationId`, `MessageId`, `ToolCallId` prevent accidental ID mixing. Use constructors at boundaries: `ConversationId(uuid())`.
- **Discriminated unions**: Message parts (`type: 'text' | 'tool-call' | 'tool-result'`), agent events (`type: 'text-delta' | 'tool-call-start' | ...`), stream chunks.
- **Path aliases**: `@shared/*` → `src/shared/*` (all targets), `@/*` → `src/renderer/src/*` (renderer only).
- **Provider registry**: `providerRegistry` singleton resolves models to providers at runtime. Each provider implements `ProviderDefinition` with `createAdapter()` for chat adapter creation.

## Electron-Vite Config

`electron.vite.config.ts` has two important settings:
- `externalizeDeps.exclude` includes ESM-only runtime packages that must be bundled into the main process output, including the TanStack AI adapters and Effect packages
- `build.rollupOptions.output.interop: 'auto'` keeps CJS/ESM interop stable for the Electron main bundle

## Security

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
- **Prefer** `unknown` plus narrowing, or Effect Schema for runtime validation when runtime validation is needed.
- **Never use `React.FC`** — define components as plain functions with explicit props interfaces.
- **Never use `forwardRef`** — React 19 supports direct ref props.
- **Never mutate Zustand state directly** — always use store actions.
- **Never use `process.env` or `import.meta.env`** — import from `./env` in main process (`src/main/env.ts`) or `@/env` in renderer (`src/renderer/src/env.ts`). Biome enforces `noProcessEnv`; only `src/main/env.ts` has an override.
- **Always use `cn()`** from `src/lib/utils` for conditional Tailwind classes.
- **Never use raw `console.*` in main process code** — use the structured logger from `src/main/logger.ts`. Create a module-level instance with `const logger = createLogger('<namespace>')` and call `logger.info(message, data?)`. The logger auto-formats output as `[namespace] message {data}`. Pass structured data as the second argument instead of `JSON.stringify()` wrappers.

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
- Write detailed plans upfront to reduce ambiguity
- Every non-trivial plan must explicitly consider the relevant first principles before implementation starts

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `docs/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Demand Simplicity
- Simple and correct first. Elegant only when it reduces complexity.
- If a fix feels hacky: "Knowing everything I know now, implement the clean solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it
- Simple does not mean shallow; the solution must still remain faithful to the first principles

### 5. Autonomous Bug Fixing
- When given a bug report: fix it autonomously. Don't ask for guidance during the fix.
- Point at logs, errors, failing tests — then resolve them
- Present the fix for review when done (commit approval still required per Git Workflow)
- Go fix failing CI tests without being told how

## Task Management

1. **Read the relevant first principles** in `docs/principles/`
2. **Plan first** for non-trivial tasks; create a plan in the conversation or a temporary plan file
3. **Verify the plan** against both first principles and current architecture
4. **Track progress** and keep the implementation aligned with the principles
5. **Explain changes** at a high level
6. **Capture lessons**: update `docs/lessons.md` after user corrections; update `docs/learnings.md` for technical findings


## Electron QA via MCP (MUST FOLLOW for UI/IPC changes)

Two MCP servers are configured in `.mcp.json` for testing the real Electron app via Chrome DevTools Protocol.

### Setup

```bash
pnpm dev:debug    # Starts Electron with --remote-debugging-port=9222
```

### Available MCP Servers

- **`electron-devtools`** (primary) — Chrome DevTools MCP pointed at Electron. Provides screenshots, a11y snapshots, JS evaluation, click/type/fill, console/network inspection, and performance analysis. Tools prefixed with `mcp__electron-devtools__`.
- **`electron-test`** (supplementary) — Playwright-based Electron testing. Provides CSS/text selectors (`text=Submit`), wait conditions, element queries. Requires `connect({ port: 9222 })` before use. Tools prefixed with `mcp__electron-test__`.

### When to Test

After implementing changes to:

- `src/renderer/` — any UI component, store, or hook
- `src/preload/` — API bridge methods
- `src/main/ipc/` — IPC handlers
- Any feature involving user interaction (composer, chat, settings, command palette)

### Minimum QA Checklist

1. `list_pages` — verify app is running and connected
2. `evaluate_script` — confirm `window.api` is available and `navigator.userAgent` includes "Electron"
3. `take_screenshot` — visual verification of the implemented feature
4. Test interactions via `click`/`type_text`/`press_key` on the specific feature
5. `list_console_messages` with `types=["error"]` — verify no console errors
6. Report results in a summary table

Load the `electron-qa` skill from `.openwaggle/skills/electron-qa/` for detailed tool reference and feature-specific test recipes.


## Principle vs Implementation Rule

Do not confuse the current implementation with the deeper intent of the system.

- The codebase shows how the system currently works.
- The first principles explain what future work must stay faithful to.

When making changes:

- respect the current architecture
- use the first principles as the base for future-facing decisions

Do not preserve weak patterns just because they already exist.
Do not introduce new patterns that conflict with the principles.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Final Rule

If a solution appears to violate any of these constraints:

- do not take shortcuts
- do not bypass the rules
- do not simplify the problem incorrectly

Instead:

- re-evaluate the design
- break the problem down further
- explore alternative approaches
- refine the implementation within the current architecture

If you are genuinely blocked:

- clearly explain the constraint conflict
- propose possible approaches
- ask for clarification before proceeding

A valid solution must always be found within these constraints.

Stopping, skipping, or degrading the solution is not allowed.
