---
name: project-learnings
description: Technical learnings log for OpenWaggle. Stores warnings, pattern preferences, and historical engineering learnings; workflow policy lives in AGENTS.md and CLAUDE.md.
owner: openwaggle-core
last_updated: 2026-02-26
---

# LEARNINGS.md

This document stores project-specific technical learnings only.

## 1) Active Warnings

- None currently.

## 2) Pattern Preferences

- Add only durable technical guidance that improves implementation quality.
- Do not add routine project-management notes unless they materially affect implementation behavior.

## 3) Recent Learnings

### Task: Orchestration Atomic Write Race Fix (2026-02-26)
- Atomic JSON writers that reuse a fixed temp filename (`<target>.tmp`) are unsafe under concurrent writes to the same target; per-write unique temp filenames are required to prevent rename collisions (`ENOENT`) that can leave orchestration task state half-persisted (for example `running` with zero attempts) and trigger deadlock-style run failures.

### Task: Waggle Clean-Break Rename (2026-02-26)
- Removing terminology compatibility in Electron apps requires a boundary-wide rename at once (IPC channel ids, preload API method names, persisted JSON keys, and renderer metadata selectors); partial renames leave silent runtime mismatches even when TypeScript compiles. [SKILL?]

### Task: Phase Snapshot Bootstrap + Run Replacement Reset (2026-02-26)
- Event-only phase subscriptions can render stale/null UI after remount or conversation switch; exposing a read-side `agent:get-phase` snapshot and applying it only when no newer event arrived avoids race-induced phase flicker/regression.

### Task: Backend-Driven Phase Labels Across Modes (2026-02-26)
- When moving phase-label mapping to backend, combining stream-chunk transitions (single-agent/waggle) with orchestration lifecycle events (task kind + status) in one main-process tracker keeps labels consistent without coupling renderer logic to orchestration run snapshots.

### Task: Reasoning Part Type vs UI Phase Labels (2026-02-26)
- TanStack `UIMessage` typing can still expose `thinking` parts even when internal persisted/domain message parts are renamed to `reasoning`; keep a clear boundary where domain payloads are normalized at storage/agent layers while renderer `UIMessage` handling remains compatible with TanStack's part taxonomy.

### Task: Memory Optimizations — Conversation Index + Attachment Hydration (2026-02-26)
- For Electron IPC attachment flows, splitting renderer-safe metadata from main-process hydrated binary sources avoids storing large base64 blobs in renderer state while preserving provider-native image/pdf support by hydrating just-in-time before agent execution. [SKILL?]
- Conversation list performance/memory is materially improved by reading a lightweight summary index and self-healing it from disk scans only when missing/corrupt; keeping index updates in save/delete paths avoids repeated full-history parsing on refresh-heavy UI events.

### Task: LLM Output Sanitization (2026-02-26)
- `rehype-sanitize` drops syntax-highlighting metadata unless `className` allowlists are explicitly added for `code`/`span`/`pre`; preserving highlight.js rendering requires whitelisting both `language-*` and `hljs*` classes while keeping URL protocols tightly constrained.

### Task: Dynamic Provider Model Fetch Wiring (2026-02-26)
- For static+dynamic provider model hydration, keeping a static baseline and merging refresh results against current runtime state (not only baseline) prevents targeted provider refreshes from accidentally wiping previously hydrated dynamic models from other providers.

### Task: Model Picker Duplicate Key Fix (2026-02-26)
- Provider model payloads can contain duplicate entries (especially local Ollama models); de-duplicate by `provider:modelId` before rendering so React keys stay stable and duplicated rows never appear.

### Task: Model Picker Provider Filter Leak Fix (2026-02-26)
- For grouped model UIs, provider tab filtering should be keyed from the containing provider group metadata, not duplicated per-model provider fields; this prevents cross-tab leaks when any individual model record is mis-tagged.

### Task: Universal Model Picker + Favorites (2026-02-26)
- Preference arrays persisted in settings (for example `favoriteModels`) should be sanitized on both read and write paths (trim + dedupe + cap) to prevent unbounded growth and stale duplicates from older persisted data.
- If model selection UI exposes providers beyond currently enabled toggles, enabling the chosen provider at selection time (when credentials already exist) prevents avoidable runtime failures (`<provider> is disabled in settings`).

### Task: Sandbox Command Execution Hardening (2026-02-26)
- Returning structured `kind: 'json'` tool results for blocked command policies (instead of throwing) keeps the agent loop alive and lets the model immediately pivot to safer follow-up commands.
- Redacting sensitive output before log-preview truncation is safer than truncating first, because secrets can otherwise leak inside the first kilobyte.

### Task: Decision Utility + Branching Refactor (2026-02-26)
- Exhaustive discriminated-union checks can be enforced without casts by threading remaining tag literals through a builder generic and making `.assertComplete()` require an argument when coverage is incomplete (`...args: [TRemaining] extends [never] ? [] : [missing: TRemaining]`).
- A lightweight AST gate using the TypeScript compiler API (`SwitchStatement` + `IfStatement` with `else` as `IfStatement`) is a reliable way to enforce branching-style conventions repo-wide without brittle regex parsing.

### Task: Subscription Auth Gap Hardening (2026-02-25)
- When wiring optional manual OAuth fallback promises, attach a sink (`void promise.catch(...)`) at creation time. Otherwise, flows that complete through automatic callback paths can still reject the unused manual promise in cleanup and trigger unhandled rejection warnings.
- Background auth refresh checks should dedupe connectivity state transitions (`connected -> disconnected -> connected`) before broadcasting status events; emitting on every interval tick creates noisy UX and makes renderer state harder to reason about.

### Task: Orchestration Runner Pipeline Refactor (2026-02-25)
- In async orchestration coordinators, returning a stage promise directly from inside a `try` block does not route downstream rejection through that `catch`; `await` the stage call (`return await ...`) to preserve centralized terminal error handling (fallback/cancel policy).

### Task: Orchestration Service Refactor + Hardening (2026-02-25)
- For TanStack `chat(...)` integration points, dependency injection is significantly easier and safer when internal code defines a narrowed `stream: true` runner contract instead of reusing the full generic `typeof chat` signature; this keeps production wiring identical while enabling deterministic, cast-free tests.
- Explicit stream lifecycle state machines (`RUN_STARTED`/`TEXT_MESSAGE_*`/`RUN_FINISHED` + terminal guard) prevent subtle fallback/cancellation regressions that ad-hoc chunk emission logic tends to reintroduce.

### Task: Workspace Package Lint Gate Expansion (2026-02-20)
- Root-level Biome `files.includes` scope (`src/**`) can silently exclude workspace package files even when explicit paths are passed; package-local Biome configs that extend root rules plus per-package lint scripts are a reliable way to enforce package linting from root gates.

### Task: Review Findings Hardening (2026-02-20)
- In orchestration fallback flows, emitting terminal stream chunks (`RUN_ERROR`/`RUN_FINISHED`) before handing off to the classic agent path can close TanStack IPC consumers early and drop fallback output; fallback paths should hand off without terminal stream emission. [SKILL?]
- Commit pipelines that expose per-file selection must pass explicit pathspecs to `git commit` (for example `-- <paths>`), otherwise previously staged unrelated files are included despite UI selection.
- Persisted run-index updates need a serialized read-modify-write queue; concurrent writes to `index.json` can silently drop run IDs.

### Task: Codebase Quality Remediation (2026-02-20)
- `buildSamplingOptions` parameter type should accept `{ temperature; topP? }` (structural) rather than the full `ResolvedQualityConfig` — this allows both agent-loop (which has a full config) and orchestration service (which has a local sampling-only subset) to share the helper without redundant type widening.
- When decomposing large React components, extracting callback-heavy prop bundles into named interfaces (`GitProps`, `OrchestrationProps`) at the type level reduces the parent component's JSX surface dramatically and makes the child's prop contract discoverable.
- `@testing-library/react` auto-cleanup relies on a globally-available `afterEach`. When vitest runs without `globals: true`, cleanup doesn't happen automatically — add explicit `afterEach(() => cleanup())` in the test setup file to prevent DOM leakage between tests.
- Component test configs using JSX need `@vitejs/plugin-react` in the vitest config's `plugins` array; without it, the automatic JSX runtime isn't configured and tests fail with "React is not defined".

### Task: Nested AGENTS.md Scope Resolution (2026-02-20)
- Path-scoped AGENTS behavior is easiest to keep agents.md-aligned by resolving deterministic chains (`root -> ancestors -> nearest`) per target path and deduping discovered scope files across inferred candidates.
- Mid-run scoped instruction loading works safely as a read-only tool (`loadAgents`) when loaded scope files and requested paths are tracked in run-local `ToolContext` state, avoiding prompt resets and preserving prior run context. [SKILL?]

### Task: Condukt In-Repo Orchestration + OpenWaggle Harness Integration (2026-02-20)
- `git subtree split --prefix=packages/core` from external repos provides a practical way to vendor only runtime package history, keeping syncability without importing docs/web app history. (condukt packages were later merged into `src/main/orchestration/engine/` — Spec 07) [SKILL?]
- For Electron + TanStack `useChat` adapters, orchestration fallbacks must still emit terminal stream chunks (`RUN_FINISHED` / `RUN_ERROR`) and preferably text chunks, otherwise same-thread conversation reloads may not rehydrate UI state until a thread switch.
- Keeping orchestration run persistence in a dedicated `{userData}/orchestration-runs` store decouples task-graph lifecycle from conversation JSON migrations and makes run-level IPC (`get/list/cancel`) straightforward.

### Task: Approval Continuation + Model Switch + Rename Parsing Fixes (2026-02-20)
- TanStack `useChat` approval responses only continue correctly when continuation requests pass the full UI message snapshot (including `tool-call.approval` state) back to the server runtime; reconstructing from only the last user text drops approval state and stalls server tools. [SKILL?]
- Continuation payloads must be converted from `UIMessage[]` to TanStack `ModelMessage[]` (for example via `convertMessagesToModelMessages`) before calling server `chat(...)`; passing raw UI message shapes causes malformed continuation runs and can leave tool blocks stuck in running state. [SKILL?]
- Continuation snapshots should dedupe repeated tool-call IDs before provider dispatch, because TanStack can surface multiple `tool-call` UI parts for one tool ID across approval transitions and Anthropic rejects duplicate `tool_use` IDs in a single request. [SKILL?]
- Recreating `useChat` client identity with `(conversationId, model, qualityPreset)` ensures adapter model/preset changes apply immediately inside existing threads.
- Git rename parsing should normalize both porcelain (`old -> new`) and numstat (`old => new`, `{old => new}`) formats to one canonical path before merging status entries.

### Task: TanStack AI Devtools End-to-End Integration (2026-02-20)
- For Electron apps where TanStack AI runs in the main process, expose a main-process `ServerEventBus` and point renderer `TanStackDevtools` at it; keep the Vite plugin event bus disabled to avoid split or duplicate streams. [SKILL?]
- Pass `conversationId` into `chat(...)` so server-side observability events correlate with renderer conversation state in AI Devtools.
- Renderer CSP must explicitly allow `img-src data:` and localhost `connect-src` (`ws/http`) or TanStack Devtools shows broken icons and cannot attach to the event bus.

### Task: Dynamic Mid-Run Skill Loading (2026-02-20)
- Keeping skill discovery metadata-only and introducing a dedicated `loadSkill` runtime tool allows mid-run specialization without mutating system prompt state or restarting the run.
- Run-scoped skill-load dedupe is easiest and safest when tracked in `ToolContext` (AsyncLocalStorage) so observability can report dynamic loads without persisting conversation state.


### Task: Subscription Auth for Providers — Spec 00 (2026-02-25)
- `node:http` `server.listen()` is async — `server.address()` returns `null` if called synchronously after `.listen()`. Use the `listening` callback or wrap in a `Promise` to reliably get the resolved port for ephemeral-port servers.
- When making a previously synchronous function async (e.g. `resolveProviderAndQuality`), all callers must be updated to `await` the result — TypeScript doesn't flag missing `await` on `Promise<T>` where `T` has `.ok` property because the Promise object itself is truthy.
- `electron-store` mocks in Vitest need a class-based mock (`class MockStore { get = ... }`) rather than a factory function, because `electron-store` uses `new Store()` constructor syntax.
- `Promise.race()` does not cancel losing branches — when racing clipboard polling against manual OAuth code input, explicitly abort/cleanup the polling branch to avoid lingering timers.
- Manual OAuth code handoff state should be keyed by provider (e.g. `Map<SubscriptionProvider, handler>`) rather than a single global resolver to prevent cross-provider or overlapping-flow resolution bugs.

### Task: Waggle Conversation — Spec 00 (2026-02-24)
- TanStack `UIMessage` strips custom metadata during `conversationToUIMessages` conversion; use a parallel lookup map (same pattern as `useMessageModelLookup`) keyed by message ID to preserve waggle metadata across the conversion boundary.
- Waggle handlers must emit stream chunks on BOTH the regular `agent:stream-chunk` channel (for TanStack adapter compatibility) AND a dedicated `waggle:stream-chunk` channel (for metadata); emitting only on the dedicated channel breaks the existing `useAgentChat` hook's stream consumption.
- Heuristic consensus detection (Jaccard similarity, explicit agreement phrases, shrinking response) avoids LLM calls and keeps waggle coordination costs constant; weighted confidence aggregation with a 0.7 threshold works well for code review / debate scenarios.

### Task: Provider Model Type Guard Refactor (2026-02-24)
- When an SDK function requires `TModel extends (typeof MODELS)[number]` but your code receives `string`, use a `Set<string>.has()` inclusion check with a type predicate (`value is T`) instead of widening the array to `readonly string[]` or casting the value. `Set<string>.has()` naturally accepts `string` as input, so no intermediate cast is needed — and the type predicate narrows for the downstream call. [SKILL?]
- `OpenRouterTextAdapter<T>` extends `BaseTextAdapter` which implements `TextAdapter`, making it assignable to `AnyTextAdapter = TextAdapter<any, any, any, any>` — the `as unknown as AnyTextAdapter` double-cast on the OpenRouter adapter return was unnecessary.

### Task: Spec 03 — Fix Error Messages Remaining Gaps (2026-02-24)
- IPC channels exposed to the renderer should be scoped to specific actions (e.g. `app:open-logs-dir`) rather than generic path openers (`shell:open-path`) — the renderer is an untrusted boundary.
- Main-process utilities like the file logger should not import `electron` directly; inject dependencies (e.g. `initFileLogger(logsDir)`) at startup so the module remains testable without mocking Electron.
- Async buffered file writes (`process.nextTick` + `fs.appendFile`) avoid blocking the event loop from synchronous `fs.writeSync` in logging; tests need a small `setTimeout` to observe flushed output.
- When an orchestration type (e.g. `OrchestrationTaskRecord`) lacks a field you need (like `title`), keep a local Map built during planning rather than casting or patching the type.

### Task: P1 Bug + Hardening Sweep H-01–H-11 (2026-02-23)
- Module-level caches (e.g. git status TTL cache) leak between test cases in Vitest; export an `invalidate*()` function and call it in `beforeEach` to prevent cross-test pollution.
- `unpdf`'s `extractText()` returns `{ text: string[] }` by default; pass `{ mergePages: true }` to get a single concatenated `string` instead.
- TanStack AI `StreamChunk` RUN_ERROR type only declares `{ message: string; code?: string }` — runtime errors carry `name`/`stack` but accessing them requires `'in'` operator narrowing + type assertion.
- `StreamPartCollector` STEP_STARTED/STEP_FINISHED handling: flush text on STEP_STARTED and flush thinking on STEP_FINISHED to break TanStack's thinking accumulation across orchestration sub-calls.
- When replacing a dependency (e.g. `pdf-parse` → `unpdf`), update integration test mocks from the old module to the new module's import path and API shape; dynamic `import()` mocks require `vi.mock()` at the correct module specifier.

## 4) Old Learnings Archive

### Task: AGENTS + `.openwaggle/skills` Runtime Standardization (2026-02-19)
- Keep standards ingestion as a dedicated agent feature (`prompt fragments + context loader`) so AGENTS and skill instructions can evolve without changing `runAgent` orchestration.
- For skill references in free-form composer input, token-start slash matching plus explicit parsing (`/skill-id`, `$skill-id`) avoids coupling UX insertion behavior to backend activation logic.
- Project-scoped skill toggles fit naturally into existing `electron-store` settings when keyed by absolute project path, allowing per-repo skill enablement without changing conversation persistence schemas.

### Task: Offline Whisper Base Voice Input (2026-02-19)
- `@xenova/transformers` can run Whisper-base locally in the Electron main process when audio is passed as normalized `Float32Array` PCM and the model cache is pinned to `app.getPath('userData')`.
- For Electron voice capture stability, record audio with `MediaRecorder` + local decode/resample in renderer and send PCM over IPC; avoid browser `SpeechRecognition` pathways in desktop shells.
- When using pnpm `onlyBuiltDependencies`, native modules required by transitive runtime deps (like `sharp` for `@xenova/transformers`) must be explicitly allowlisted or local model loading fails at runtime.
- Moving voice IPC payloads from JSON number arrays to binary PCM (`Uint8Array`) plus defaulting to tiny local Whisper significantly reduces transcription latency on desktop builds.
- During active feature migrations, keep IPC handlers backward-compatible for one payload version (accepting both legacy and new shapes) to avoid renderer/main hot-reload contract mismatches in Electron dev sessions.

### Task: Composer Modal + Voice Crash Fixes (2026-02-19)
- In Electron dev shells, `window.prompt`/`window.confirm` can be unsupported in renderer contexts; use in-app modal flows for branch and permission actions.
- Setting `SpeechRecognition.processLocally = true` can trigger Chromium `OnDeviceSpeechRecognition` bad Mojo termination in Electron builds that do not expose that binder.

### Task: UI Product Gap Closure (2026-02-19)
- `electron-store` defaults can make migration checks ambiguous; use raw persisted settings presence (via store file) when deciding legacy-vs-new defaults for execution mode.
- Attachment pipelines should strip binary payloads before persistence and keep only path/metadata/extracted text in conversation JSON to avoid oversized history files.

### Task: Agent Loop Extensibility Foundation (2026-02-19)
- Treat the agent runtime as a feature pipeline (`prompt fragments + tool providers/filters + lifecycle hooks`) so new capabilities can be added without editing `runAgent` orchestration logic [SKILL?]
- Execution-mode policy should filter tools before dispatch (for clearer model behavior) while keeping execution-time guards as a second safety layer

### Task: Anthropic Sampling Param Conflict (2026-02-19)
- Anthropic chat requests can fail when both `temperature` and `top_p` are sent together; provider-specific quality resolvers should emit only one sampling control to avoid hard API rejection.

### Task: Diff Review Panel (2026-02-19)
- Biome's `useExhaustiveDependencies` treats computed local variables (e.g. `const fetchKey = ...`) as "outer scope" and rejects them from deps arrays; use React `key` prop to force re-mount instead of `refreshKey` deps for data-fetching effects
- When parsing `git diff HEAD` output, split on `^diff --git ` boundary to get per-file chunks; the `b/` path from the header is the canonical file path for renames
- Diff panel theme tokens: `--color-diff-file-bg: #141922`, `--color-diff-file-border: #343d4d` for the card-style diff sections (distinct from the existing `--color-diff-card-*` tokens)

### Task: Conversation Lifecycle + Git IPC Foundations (2026-02-19)
- In TanStack `useChat` IPC adapters, wiring `AbortSignal` directly to server-side cancellation causes runs to terminate when switching threads; use explicit user-cancel paths instead so background runs can complete [SKILL?]
- `needsApproval` server tools surface as `tool-call` parts in `approval-requested` state and require `addToolApprovalResponse()` wiring in the renderer, otherwise tool execution stalls indefinitely

### Task: Repository-Wide Review Remediation (2026-02-19)
- `fast-glob` can match parent-directory patterns like `../*` even with `cwd` set; validate glob inputs explicitly to keep file-discovery tools confined to the selected project root [SKILL?]
- Settings write-time validation (especially provider `baseUrl`) should match read-time validation to prevent silent fallback to defaults after restart

### Task: Test Coverage Baseline (2026-02-19)
- Vitest `vi.mock()` factories are hoisted before top-level variables; shared mock handles referenced inside factory closures should be initialized via `vi.hoisted(...)` to avoid runtime `ReferenceError` in integration tests [SKILL?]
- Electron e2e tests are deterministic when main-process `userData` can be overridden through an env var (`OPENWAGGLE_USER_DATA_DIR`), allowing relaunch persistence assertions without mutating local developer state

### Task: IPC Stream Termination During Tool Calls (2026-02-19)
- TanStack AI can emit an intermediate `RUN_FINISHED` with `finishReason: 'tool_calls'` before server tool execution results are streamed; treating any `RUN_FINISHED` as terminal in the renderer IPC adapter truncates later `TOOL_CALL_END.result` chunks and leaves tool blocks stuck running [SKILL?]

### Task: Agent File-Tool Stall Investigation (2026-02-19)
- TanStack AI server tool execution treats string returns as JSON-encoded payloads; plain-text tool outputs can surface as tool errors unless wrapped in a structured result contract (`kind: 'text' | 'json'`) [SKILL?]
- Persisted tool result error metadata should be derived in main-process stream handling (`TOOL_CALL_END`) and then mapped back into UI tool-result state; relying only on renderer-side content parsing causes contract drift

### Task: Backlog Completion (2026-02-19)
- For conversation schema refactors, keep persisted JSON backward-compatible by making removed fields optional in Zod and using legacy values to backfill per-message data during parse
- Root-level renderer error handling in React 19 still requires a class-based error boundary; wrap `<App />` in the boundary from `main.tsx` to avoid blank-screen failures
- `Object.fromEntries` can widen values to `string | undefined`; use an explicit `Record<string, SupportedModelId>` fill loop when strict prop types require defined values

### Task: Pencil "No Diff" UI Redesign (2026-02-18)
- Biome enforces `noStaticElementInteractions` — use CSS `group-hover:visible` / `invisible` pattern instead of `useState` hover tracking with `onMouseEnter`/`onMouseLeave` on `<div>`
- When restructuring layout (moving components between parent containers), update props interfaces in both parent and child to keep TypeScript happy
- New design tokens added to `@theme` block: `--color-input-card-border`, `--color-button-border`, `--color-diff-card-bg`, `--color-diff-card-border`, `--color-link-yellow` — use Tailwind classes like `border-input-card-border`, `bg-diff-card-bg`
- Composer now owns the status bar (Local/Full-access/git-branch) as its bottom row — no separate StatusBar component
- Inter font added as primary sans-serif in `--font-sans`
