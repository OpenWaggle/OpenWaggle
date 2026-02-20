---
name: project-learnings
description: Technical learnings log for OpenHive. Stores warnings, pattern preferences, and historical engineering learnings; workflow policy lives in AGENTS.md and CLAUDE.md.
owner: openhive-core
last_updated: 2026-02-20
---

# LEARNINGS.md

This document stores project-specific technical learnings only.

## 1) Active Warnings

- None currently.

## 2) Pattern Preferences

- Add only durable technical guidance that improves implementation quality.
- Do not add routine project-management notes unless they materially affect implementation behavior.

## 3) Recent Learnings

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

### Task: Condukt In-Repo Orchestration + OpenHive Harness Integration (2026-02-20)
- `git subtree split --prefix=packages/core` from the Condukt source repo provides a practical way to vendor only runtime package history into `packages/condukt-ai`, keeping syncability without importing docs/web app history. [SKILL?]
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


## 4) Old Learnings Archive

### Task: AGENTS + `.openhive/skills` Runtime Standardization (2026-02-19)
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
- Electron e2e tests are deterministic when main-process `userData` can be overridden through an env var (`OPENHIVE_USER_DATA_DIR`), allowing relaunch persistence assertions without mutating local developer state

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
