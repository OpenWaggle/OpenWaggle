---
name: project-learnings
description: Technical learnings log for OpenWaggle. Stores warnings, pattern preferences, and historical engineering learnings; workflow policy lives in AGENTS.md and CLAUDE.md.
owner: openwaggle-core
last_updated: 2026-03-09
---

# LEARNINGS.md

This document stores project-specific technical learnings only.

## 1) Active Warnings

- None currently.

## 2) Pattern Preferences

- Add only durable technical guidance that improves implementation quality.
- Do not add routine project-management notes unless they materially affect implementation behavior.

## 3) Recent Learnings

### Task: Post-Migration Approval Flow Latency + Log Spam Hardening (2026-03-09)
- Approval-trace diagnostics must stay fully opt-in and outside chunk hot paths. Logging every `TOOL_CALL_ARGS` / streamed text chunk in either the main process or renderer IPC adapter materially slows approval continuations and floods Electron console output.
- Large `writeFile` / `editFile` tool results should not inline full before/after file bodies once the payload gets beyond a small threshold. Compact JSON summaries preserve the useful metadata for the UI while avoiding multi-kilobyte tool results that can degrade continuation latency and leak raw function-result payloads back into model responses. [SKILL?]
- Duplicate pending approvals must be scoped to the current user turn. When TanStack continuation replay re-proposes a side-effecting tool call with the same args in the same turn, the safe behavior is to auto-skip it rather than auto-approve it again; matching tool calls from earlier user turns are legitimate new work and must not be collapsed. [SKILL?]
- `react-virtuoso` `followOutput=\"smooth\"` during token streaming makes chat feel visibly clanky because every incremental height change becomes an animated scroll step. For streaming transcripts, use immediate follow while loading and reserve smooth scrolling for non-streaming append cases. [SKILL?]
- Renderer cache layers only help when upstream lookup hooks preserve referential identity. A manual ref-based cache on transcript rows was effectively inert until `useMessageModelLookup` and `useWaggleMetadataLookup` stopped returning fresh objects on unchanged inputs.
- MCP stdio transports must use the same safe child-environment allowlist as command execution. Forwarding the full parent `process.env` leaks provider API keys and OAuth tokens to arbitrary configured MCP subprocesses. [SKILL?]

### Task: Post-Migration E2E Harness Stabilization (2026-03-09)
- Electron E2E readiness checks should anchor on stable shell controls such as the sidebar `New thread` button, not empty-state marketing copy like `Let's build`. Once persisted SQLite data exists, the app can legitimately open straight into an existing thread, and copy-based readiness probes become false negatives even when the shell is fully loaded.

### Task: Post-Migration First-Send Regression Hardening (2026-03-09)
- First-send UX in OpenWaggle depends on main-process persistence of the user turn even when the run fails before assistant output (for example missing project path, unknown model, or early provider/setup failure). Forcing project selection in the renderer regressed existing flows like starter prompts and long-paste auto-attachments; the correct fix is to keep the renderer send path simple and persist the user message in the main `agent:send-message` failure path.

### Task: Electron Session Data Startup Fix (2026-03-09)
- Chromium session services in Electron 40 can still emit `Failed to initialize the DIPS SQLite database` even when `userData` and `sessionData` are prepared early. In this app, a stale `session-data/DIPS*` database was the real trigger; the clean fix is a versioned one-time profile repair before the first `BrowserWindow`, not deleting Chromium DIPS files on every launch. [SKILL?]

### Task: Effect-TS Adoption with SQLite Runtime (2026-03-09)
- With pnpm + Electron 40, `electron-builder install-app-deps` can still leave `better-sqlite3` loading a Node-ABI binary at runtime. The reliable fix was an explicit Electron-target rebuild of `better-sqlite3` using `npm_config_runtime=electron`, `npm_config_target=<installed electron version>`, and `npm_config_disturl=https://electronjs.org/headers`, while keeping a separate plain `pnpm rebuild better-sqlite3` path for Node-based Vitest runs. [SKILL?]
- Playwright Electron E2E helpers should not forward the entire parent `process.env` into the app. Passing through runner-specific Node/Playwright environment can make Electron exit before the first window is available; a small allowlist of stable shell/user env vars plus explicit test overrides is much safer.
- At the TanStack server-tool boundary, explicit per-run `ToolContext` binding is cleaner than an ambient context service. It keeps Effect in control of the agent runtime while matching TanStack's tool execution model without hidden global state or casts.

### Task: Push-Gate Test Stabilization (2026-03-09)
- Renderer hook tests that mock Zustand selectors must return stable function identities for function-valued slices (for example `hasActiveRun`). Returning a new function on every render can retrigger effects that depend on that selector result and create misleading infinite rerender/OOM failures that never happen with the real store.

### Task: T3Code Competitive Analysis — Spec Design (2026-03-07)
- Shiki syntax highlighting uses WASM grammars that need explicit asset handling in electron-vite config (`assetsInclude: ['**/*.wasm']`); unlike highlight.js CSS classes, Shiki outputs inline `style` attributes with `color` properties, which affects CSP and sanitization schema configuration.
- Lexical editor integration in a Composer that has many existing behaviors (history, voice, paste, command palette trigger) requires preserving all of them through Lexical plugins rather than raw `onKeyDown` handlers — Lexical intercepts keyboard events before they reach the component, so handlers must be registered as Lexical command listeners.
- SQLite in Electron requires careful library selection: `better-sqlite3` needs native addon compilation (electron-rebuild) while `node:sqlite` (Node 22+) may not be available in Electron's bundled Node version — the Electron-bundled Node version is the constraint, not the system Node. [SKILL?]

### Task: Approval Execution Hardening After TanStack React Fix (2026-03-07)
- After the upstream `@tanstack/ai-react` continuation deadlock fix, the remaining false-success risk was not loading-state related: TanStack approval placeholder payloads such as `{"approved":true,"pendingExecution":true}` can still flow through as ordinary tool-result content, so both renderer UI and lifecycle logging must explicitly distinguish placeholder approval markers from concrete execution results.
- Pending approval visibility across thread switches depends on preserving renderer-side trust-resolution state per approval/tool-call. Clearing that cache on "no active pending approval" causes a thread switch to hide an already-untrusted approval banner until trust is re-checked, even though the persisted tool state is still pending.
- Approval denial synthesis must treat any already-persisted `tool-result` for that `tool_use` as terminal, including denied results. Otherwise later unrelated continuation runs can keep re-synthesizing an old denial and pollute the active transcript with stale pending/denied tool state.
- Renderer reconciliation for tool-call arguments should ignore obviously partial JSON while tool args are still streaming. Logging every failed parse of `{"pa`, `{"path":"fi`, etc. turns normal incremental argument streaming into noisy false alarms.
- Transcript-level duplicate tool-call reconciliation inside a single user turn must prefer the richest/latest occurrence, not the first one. Otherwise a stale early `approval needed` row can survive while a later continuation message already contains the terminal denied/completed tool result and matching assistant text.
- Renderer auto-trust checks for pending approvals must re-verify that the same approval is still current right before dispatching `respondToolApproval`. Trusted tools can execute inline fast enough that a stale trust-check resolution otherwise fires a bogus approval continuation after the concrete tool result is already present.
- Seeded Electron approval E2E fixtures should avoid trustable tool names (`writeFile`, `editFile`, `runCommand`, `webFetch`) when the goal is to assert pending approval visibility. Otherwise project-level trust config can auto-resolve the fixture and make thread-switch/pending-state regressions flaky.
- Persisted tool-call lookup and approval/state restoration should live in one shared renderer helper. Duplicating signature matching and metadata merge rules across hydration and pending-approval detection makes the two paths drift and reintroduces approval-state inconsistencies after reloads or follow-up turns.

### Task: Voice Recorder Visualizer + Transcription Quality (2026-03-07)
- Local Whisper transcription quality dropped sharply when the renderer hard-coded the smallest English-only model (`tiny.en`) and forced `language: 'en'`; switching the default request path to `base` plus language auto-detection materially improves multilingual/accent robustness without changing the privacy model.

### Task: Audit Remediation (2026-03-06)
- Shared IPC channel maps are expressive enough to generate preload `invoke`/`send`/event-subscription helpers directly; exporting channel arg/payload utility types lets the preload surface stay DRY without weakening the `OpenWaggleApi` contract.
- File logger failures should degrade to a stderr fallback, not silent no-ops; otherwise the exact moments when disk/log directory issues happen become the moments with the weakest diagnostics.
- Async failure handlers in renderer queue hooks should capture the render-time callback when the send starts; reading a mutable ref at rejection time can misattribute feedback after conversation switches.
- Orchestration checkpoint fields must be added in four places together: engine snapshot state, shared persisted types, Zod validation schema, and run-repository mapping. Missing any one of those silently drops resume-time behavior back to defaults.
- Centralized attachment-extraction diagnostics only work if low-level extractors throw and let the shared fallback wrapper log; returning `''` inside each extractor hides which parser/OCR path failed and defeats regression assertions.

### Task: TanStack Query Phase 1 (2026-03-06)
- In this Electron renderer, TanStack Query works best as a cache/invalidation layer for IPC request-response resources while Zustand keeps runtime state; trying to move live session/stream state into Query creates awkward boundaries instead of reducing complexity.
- When a resource refetch can remove the currently selected entity, refetch the parent catalog first and only invalidate the dependent detail query if the refreshed catalog still contains that selection; invalidating the detail query too early can refetch a disappearing record and create noisy undefined-data warnings.
- For Electron IPC resources, TanStack Query should usually run with `networkMode: 'always'`; otherwise offline-aware browser defaults can misclassify local IPC-backed queries and mutations as paused network work.
- Mutation wrappers that return `{ ok: false }` should be normalized into thrown `Error`s before they reach TanStack Query; otherwise the library records them as successful mutations and `error` / retry / devtools behavior becomes misleading.
- Query-backed screens should keep initial-load errors separate from mutation/action errors; collapsing them into one `error` branch often hides still-valid cached data and turns recoverable action failures into full-screen dead ends.
- For shared renderer resources, `queryOptions(...)` should be the primary abstraction boundary and trivial `useQuery` wrappers should be avoided; consumers can compose those shared options with only their local concerns, which keeps type inference strong and matches TanStack's recommended layering.

### Task: TanStack Known Issues Regression Matrix (2026-03-05)
- `@tanstack/ai` root runtime export surface does not include `BaseTextAdapter` even though typings suggest it; tests that need lightweight adapters should use structural `TextAdapter` objects instead of subclassing the base class. [SKILL?]
- A deterministic continuation probe can be reproduced without external providers by seeding `chat(...)` with an unresolved tool call (`assistant` toolCall + `tool` message containing `pendingExecution: true`) and a local mock adapter; this makes upstream chunk-shape changes testable in CI.

### Task: Review Follow-up Regression Hardening (2026-03-05)
- Trusted `runCommand` wildcard matching should reject shell-chain operator continuations (`;`, `&&`, `||`, pipes) even when prefix patterns match; safe allowlists need token-boundary-aware matching rather than generic glob-to-regex conversion. [SKILL?]
- Transcript-level tool-call deduplication must reset per user turn; global dedup across the full message list hides legitimate repeated commands in later turns and distorts conversation history reconstruction.

### Task: Trusted Approval Auto-Respond Race Guard (2026-03-05)
- Auto-responding tool approvals before TanStack emits `approval` metadata can silently no-op continuation: `addToolApprovalResponse` only marks `approval-responded` when a matching `part.approval.id` is already present in UI message parts.
- Pending-approval fallback detection (for delayed custom chunks) should carry an explicit `hasApprovalMetadata` flag so renderer logic can defer both manual and trusted auto-approval actions until metadata is present.
- Hiding approval controls while `hasApprovalMetadata === false` avoids dispatching synthetic approval responses that appear successful in UI but never resume the run.

### Task: Approval Continuation Runtime Patch Coherence (2026-03-04)
- TanStack patching in this repo must target `dist/esm` files, not only `src`, because Electron runtime executes bundled `dist` exports. A source-only patch can appear “fixed” in code review but be inert at runtime after reinstall.
- `runCompleted` can race ahead of final stream chunks; a very short renderer close grace can truncate late terminal/final-text chunks. A bounded grace window plus regression coverage for delayed terminal chunks is needed to preserve completion fidelity.
- `ERR_PNPM_INVALID_PATCH` with “hunk header integrity check failed” can come from a hand-edited patch artifact even when the underlying fix is correct. The reliable recovery path is to regenerate `patches/@tanstack__ai@0.6.1.patch` from a clean vanilla-vs-patched package diff (or `pnpm patch/patch-commit` when available), then rerun `pnpm i` to refresh the lockfile patch hash.
- Approval continuation reliability also depends on delayed approval metadata chunks: when a `TOOL_CALL_END` arrives without `result`, the renderer stream adapter must keep the stream open longer after `run-completed`, otherwise late `CUSTOM: approval-requested` chunks are dropped and trust/auto-approval cannot proceed.
- Trusted-approval checks should use the active conversation project path as primary source, not only the global settings project path; when these diverge, trust APIs are skipped and the UI remains stuck in approval-needed state despite valid allow-patterns.

### Task: Prompt-Matrix Verification Harness (2026-03-04)
- Electron runs launched through Playwright can hit macOS `safeStorage` decrypt failures for persisted `enc:v1:` provider secrets, producing generic renderer `RUN_ERROR` surfaces (`"Something went wrong"`) before any tool-call validation path is exercised. Prompt-level verification harnesses must account for this environment constraint (or seed plaintext test credentials) to avoid false negatives on continuation/approval regressions.

### Task: Approval Continuation Pairing + Trusted Approval UX (2026-03-04)
- Synthetic unresolved `tool-result` entries for `TOOL_CALL_END` chunks without `result` can poison continuation history and trigger Anthropic `unexpected tool_use_id` contract errors on resumed runs. For non-timeout completions, unresolved tool calls should remain unresolved instead of being converted into error results.
- Continuation normalization must enforce assistant-tool adjacency for tool results: any `tool` message without a matching `tool_call` in the immediately preceding assistant message should be dropped before sending to provider APIs.
- Assistant-to-tool pairing in continuation normalization must persist across consecutive `tool` messages emitted from the same assistant turn (e.g. assistant with tool A+B followed by tool(A), tool(B)); enforcing strict immediate-adjacency per tool message drops valid results and can desync follow-up context.
- Trusted approval checks in the renderer should hide pending approval UI while trust resolution is in-flight; otherwise pre-approved commands can briefly flash approval banners and degrade perceived responsiveness.
- Renderer trust-check side effects should always include cleanup guards for async continuations (`active`/abort flag), so stale promise resolutions cannot auto-approve superseded tool calls after pending-approval state changes.
- Pending-approval selection must use newest-unresolved semantics (reverse traversal + filter out tool-call ids with existing tool results). Returning the first historical `approval-requested` part can keep selecting stale approvals and prevent later tool calls from ever receiving auto-approval/approval UI.
- TanStack AI `updateToolCallPart` can overwrite existing `tool-call` parts and drop `approval` metadata unless the updater explicitly preserves previously attached `approval`/`output` fields. When this happens, follow-up approvals become invisible to the renderer and continuation no-ops.
- Pending-approval detection must treat `pendingExecution` as unresolved even when it appears on `tool-call.output` or inside stringified/wrapped payloads (for example `{"kind":"json","data":{"pendingExecution":true}}`), otherwise the approval banner can disappear while the tool row still shows `(approval needed)`.
- In Vite/Electron dev mode, patch-package updates under `node_modules` can be masked by stale `.vite/deps` prebundles. For TanStack runtime contract fixes, forcing renderer dependency re-optimization in dev (`optimizeDeps.force = true`) prevents running an old prebundle after patch changes.

### Task: TanStack AI 0.6.1 Upgrade + Patch Surface Reduction (2026-03-04)
- `@tanstack/ai` `0.6.1` already includes early `tool-result` emission before approval/client-execution wait branches, so local patches that previously moved result emission in `activities/chat/index.ts` can be dropped.
- Mixed approval/non-approval tool batches still need explicit approval-first gating to avoid running side-effecting tools before unresolved approvals in the same batch; this behavior is still not enforced upstream in `activities/chat/tools/tool-calls.ts`.
- TanStack `CustomEvent` typing now uses `value` instead of `data`; local helper/test fixtures that construct custom chunks must use `value` to keep `tsc` green after upgrade.

### Task: Continuation No-Op After Malformed Tool Args (2026-03-04)
- Continuation fallback logic in the renderer adapter must be scoped to actual approval-continuation snapshots; falling back on any non-user last message can trigger instant no-op runs (`run-start` + `run-complete` in milliseconds) that look like the conversation cannot continue.
- For malformed tool-call argument JSON in continuation snapshots, normalizing arguments to valid object JSON (`{}`) prevents TanStack parse crashes, but adapter-side guardrails are still needed to avoid accidentally sending empty continuation payloads.
- Persisted assistant turns can contain unresolved tool calls (tool-call without tool-result). Replaying those unresolved calls into provider history can cause subsequent runs to terminate immediately with `(no response)`. History mappers should only replay tool calls that have matching tool results.
- Reverse-ordered continuation dedupe must be tool-call-aware when keeping tool-results: if a newer assistant turn already owns a tool-call id, older tool-result entries for that id should be dropped, otherwise Anthropic can reject follow-up requests with `unexpected tool_use_id` due to broken call/result pairing.

### Task: Dev Blank Screen — CSP + Vite React Preamble (2026-03-04)
- A strict `script-src 'self'` CSP can break Electron renderer startup in Vite dev mode because `@vitejs/plugin-react` injects an inline preamble script; when blocked, renderer fails with `@vitejs/plugin-react can't detect preamble` and shows a blank window.
- The least-privilege fix is to allow only the exact preamble hash in `script-src` (instead of adding `'unsafe-inline'`), preserving CSP protection while restoring dev boot behavior.

### Task: Spec 06 — Executor Permissions + Default-Permissions Trust (2026-03-04)
- Zod v4 `z.record(z.enum([...]), valueSchema)` enforces a complete enum-keyed map, not a partial map. For optional per-tool config objects, a `z.object({...optional keys...})` schema avoids false validation failures when only one tool entry is persisted.
- Orchestration executor runs that use TanStack tools with `needsApproval: true` can hang when there is no direct approval bridge in that nested execution path. A safe fallback is to strip approval requirements in executor scope and enforce trust policy synchronously (allow trusted patterns, return structured block errors otherwise).

### Task: Spec 04 — Electron Security Defaults (2026-03-04)
- Electron's current TypeScript declarations do not expose a typed `webContents.getLastWebPreferences()` path, so startup hardening checks are most robustly enforced by asserting the exact `webPreferences` object passed into `BrowserWindow` before creation, then failing closed on bootstrap errors.

### Task: Spec Verification + Archive Sweep (2026-03-04)
- `react-doctor` can default to changed-files-only scanning on feature branches; for a true full-repo baseline scan during verification, disabling git diff detection (for example `GIT_DIR=/nonexistent`) forces full source discovery.
- React Compiler checks can fail on `try`/`finally` blocks without a `catch` clause in renderer components; rewriting to promise-chain cleanup (`await fn().catch(() => null); cleanup()`) preserves behavior and clears the compiler error.

### Task: Shared vs Local Project Config Split (2026-03-03)
- Preventing git pollution for machine-local config in project/worktree setups requires handling both `.git/` directories and `.git` pointer files (`gitdir: ...`) before writing to `info/exclude`; assuming `.git` is always a directory misses common worktree layouts.

### Task: SRP/DRY/Type Safety Review Fixes (2026-03-03)
- Continuation normalization must drop `UIMessage` entries with `role: "system"` instead of remapping them to `ModelMessage` user turns; TanStack’s native conversion path skips system snapshots, and remapping can unintentionally promote system guidance into user context.
- Stream loops that repeatedly wait on `iterator.next()` with abort support need explicit abort-listener cleanup on every iteration (`removeEventListener`), otherwise unresolved tool waits can accumulate stale listeners over long-lived approval pauses.

### Task: Tool-Call Hang After Long-Attachment Follow-up (2026-03-03)
- TanStack streams can emit `TOOL_CALL_END` without a result payload and never deliver a follow-up result chunk; if persisted as a bare `tool-call`, renderer tool blocks remain in perpetual running state (`Writing...`). Collector finalization must synthesize an explicit error `tool-result` for unresolved tool calls to guarantee terminal UI state. [SKILL?]
- Stream-stall retries should be disabled when the collector has incomplete tool calls; retrying in that state can duplicate side-effectful tools (for example `writeFile`) and extends perceived hangs without improving recovery.
- Large pasted attachments can cause provider streams to stall while the model serializes huge `writeFile.content` JSON args. The reliable fix is attachment-aware tool execution (`writeFile` with `attachmentName` / single-attachment fallback), so tools read content from run context instead of re-streaming the full payload through tool-call args.
- Attachment-aware tool context must include the latest user attachment turn on follow-up messages (e.g. "save it to root"), not only current payload attachments; otherwise `writeFile` cannot resolve `attachmentName` in subsequent turns and silently fails user intent.
- `TOOL_CALL_END` without result payload should not be treated as an error on normal stream completion; reserve synthetic error results for true timeout/incomplete conditions to avoid false `toolErrors` and misleading failure UX.
- Project-level trust persistence should use a single config writer that guarantees `.openwaggle/config.toml` exists before writes and performs atomic updates; this prevents first-write approval persistence from failing on missing config files and avoids partial writes during process interruption.
- Approval continuation state must keep assistant `tool-call` parts (especially `state: "approval-responded"` + `approval.id/approved`) through renderer->main payloads; pre-converting continuations to plain model messages drops this metadata and causes approved tools to no-op on follow-up runs.
- Approval-pending tool calls should not use fixed unresolved-result grace timeouts; streams must wait indefinitely (until user approval/denial or explicit abort) to match user-driven approval pacing and prevent false timeout terminations.

### Task: Auto-Convert Long Prompt to Attachment (2026-03-03)
- React Compiler + React Doctor can flag renderer code as non-optimizable when `try/catch` blocks contain value-branching logic. Rewriting async error handling to `await promise.catch(() => null)` and branching outside `try/catch` preserves behavior and clears the compiler error. [SKILL?]
- For real progress UI on local file generation in Electron, replacing `fs.writeFile` with chunked `fs.open(...).write(...)` loops plus renderer progress events (`bytesWritten/totalBytes`) provides accurate progress bars without network/upload semantics. [SKILL?]
- Attachment transcript previews are a UX contract: clipping extracted text for auto-generated long-prompt files can be misinterpreted as payload truncation even when backend receives full content. Suppressing preview bodies for those generated files preserves user trust while keeping full extracted text in the agent payload path.

### Task: Stream Stall Detection & Auto-Recovery (2026-03-03)
- `for await (const chunk of stream)` on an `AsyncIterable<StreamChunk>` blocks indefinitely when the provider API stalls mid-stream. Replace with manual `iterator.next()` + `Promise.race` against a timeout promise to detect stalls and allow retry.
- When an agent handler's `finally` block omits `clearAgentPhase()`, the phase tracker retains a stale phase forever ("Thinking..." ghost), because no terminal event resets it — only explicit cleanup does.
- TanStack AI's `isLoading` can go `false` when the `sendPromise` resolves even though the main process still has an active run (e.g. stuck stream). Augmenting the renderer's `isLoading` with `agentPhase !== null` keeps the cancel button visible whenever the main process reports an active run.

### Task: Magic Number Review Fixes (2026-03-03)
- A strict inline-literal checker needs to treat numeric literals nested inside named constant initializers (e.g. `FIVE_MINUTES_IN_MILLISECONDS = 5 * ...`) as valid; checking only direct literal initializers creates false positives.
- For large existing codebases, a practical anti-regression guardrail is to enforce a baseline cap for non-descriptive numeric constant names and fail only when the count increases, while still reporting the remaining debt for incremental cleanup.

### Task: Repository-Wide Magic Number Extraction (2026-03-03)
- A TypeScript AST-based checker is reliable for enforcing a strict no-magic-number policy in mixed TS/TSX/JS codebases when it explicitly excludes test files, type-only numeric literals, enum members, and named constant initializers.
- Keeping `0`/`1` allowances as explicit guard conditions in the checker avoids noisy false positives for self-evident indexing/comparison while still blocking all other inline numeric literals.
- After a broad extraction pass, a second DRY pass that centralizes repeated literals into a shared constants module (`src/shared/constants/constants.ts`) significantly reduces duplication and improves naming consistency without changing runtime behavior.
- Script governance checks are easier to maintain as TypeScript entrypoints executed with `tsx`; this preserves full Node runtime behavior while allowing typed script evolution and keeps script tooling consistent with the rest of the repo.

### Task: Review Findings Hardening (2026-03-02)
- When extracting a shared cleanup function from one IPC handler to a separate module (for reuse in another handler), all unit tests that mock the individual functions must also mock the new module. Test failures manifest as "function not called" because the mocked individual modules are no longer reached through the extracted wrapper.
- Late-binding DI (`registerFn`/`getFn` pattern in a facade module) is a clean solution for breaking circular import cycles in tool→runner→tool chains. Only the `import type` is safe as a static import from the cycle-creating module; the runtime function is registered once at app startup after all modules are loaded.
- `electron-store` creates a store instance at module-level import time. Any module that statically imports a settings module triggers Electron's app path resolution, which fails in test environments. Keep settings imports lazy (`await import(...)`) in tool files that are imported transitively by test suites.

### Task: Background Streaming & Stream Reconnection (2026-03-02)
- TanStack AI's `setMessages()` only accepts `UIMessage[]`, not a functional updater `(prev) => UIMessage[]`. When subscribing to IPC events that need to append deltas to the latest message array, use a `messagesRef` pattern (a ref always pointing to the latest messages) to read current state inside listeners without needing a functional updater.
- For unified stream buffering across agent modes (classic + Waggle), buffer at the `stream-bridge` level (where `emitStreamChunk` broadcasts to all windows) rather than per-handler — one `StreamPartCollector` per active conversation covers both modes with zero handler changes. [SKILL?]
- `StreamPartCollector.snapshotParts()` must be non-destructive (no flush) so the collector can continue accumulating chunks after a renderer reads the snapshot for reconnection.

### Task: Phase Tracking & Orchestration Narration Bugs (2026-03-01)
- When orchestration events bypass `stream-bridge.emitOrchestrationEvent()` and send directly via `webContents.send()`, the phase tracker never learns orchestration is happening — its `mode` stays `'classic'` and TEXT_MESSAGE_CONTENT sets "Writing" instead of orchestration-specific labels. Always route orchestration events through the stream-bridge to keep phase state and IPC broadcasting in sync.

### Task: Orchestration Redesign — Dead Code Cleanup (2026-03-01)
- When removing a pipeline stage (planner) from an orchestration runner, the cleanest approach is to accept pre-computed plan data as a parameter (`planJson?: JsonValue`) instead of conditionally skipping the stage — this eliminates the need for mock-heavy planner tests and makes the runner's contract explicit about what it requires.
- TypeScript infers `dependsOn?: undefined` when some object literal variants omit the field in a union; since `undefined` is not assignable to `JsonValue`, test fixtures containing optional fields must be explicitly typed as `JsonValue` to avoid TS2322 errors.
- `Rule.either('running' as const, 'retrying' as const)` is required when combining literal values in `choose()` chains — without `as const`, TypeScript widens to `string` and breaks the exhaustiveness checker.

### Task: Orchestration Streaming Fix (2026-02-28)
- TanStack AI `model-runner` stream chunks carry TanStack's internal `messageId` which differs from the orchestration `StreamSession`'s `messageId`. Forwarding raw TEXT_MESSAGE_CONTENT to `emitChunk` confuses useChat in the renderer. Instead, intercept TEXT_MESSAGE_CONTENT at the caller and route the delta through `streamSession.appendText()` which re-emits with the correct messageId.
- `modelText()` can forward TEXT_MESSAGE_CONTENT to `onChunk`, but callers that don't want raw text streaming (planner/JSON, executor tasks) must wrap `onChunk` to filter it. Only synthesis should route text through StreamSession for real-time display.
- `Promise.race([work, timeout])` leaves the `setTimeout` timer running after the work resolves. Always wrap in `try/finally` to `clearTimeout` — leaked timers keep the Node event loop alive and prevent clean shutdown.

### Task: MCP Client Infrastructure (2026-02-27)
- `@modelcontextprotocol/sdk` is ESM-only and must be added to `externalizeDeps.exclude` in electron-vite config to be bundled into the CJS main process output (same pattern as `@tanstack/ai-*` packages).
- `StdioClientTransport.env` expects `Record<string, string>` but `process.env` values are `string | undefined`. A helper that filters out undefined entries (`getFullProcessEnv()` in env module) avoids unsafe spreading. [SKILL?]
- MCP SDK's `setNotificationHandler` requires the exported schema object (`ToolListChangedNotificationSchema`) not an inline `{ method: '...' }` object — the type system uses branded schema types for notification dispatch.
- MCP `callTool` returns content parts as an array of `{ type: string; text?: string }` objects. Use Zod `safeParse` instead of `as` casts to validate content structure at MCP boundaries for runtime safety.

### Task: Polyglot Project Context Detection (2026-02-27)
- File-presence signal detection (`fast-glob` with `deep: 2`) is a more portable approach to ecosystem detection than dependency-key lookups in `package.json`, since it works across all language ecosystems (Python, Rust, Go, etc.) without language-specific parsing.
- `.gitignore` patterns map closely to fast-glob ignore patterns with three simple transforms: directory patterns (`dir/` → `dir/**`), unanchored patterns (no `/` → `**/<pattern>`), and root-anchored patterns (leading `/` → strip). This avoids hardcoded ignore lists that drift from actual project config.

### Task: Wrapper/Prop Pattern Remediation (2026-02-27)
- Synchronizing a large render-built controller object into a shared store via effect (`setController(controller)`) causes broad subscription churn even when only a few fields change; sectioned contracts passed at component boundaries (`transcript/composer/diff`) remove that update pressure while keeping a single `useAgentChat` instance.
- Oversized pass-through prop interfaces in renderer composition are often best removed by collapsing the intermediate contract (e.g., inlining a dropdown portal and passing reducer/index tuple for editable cards) instead of introducing another wrapper abstraction.

### Task: ChatPanel Controller Decomposition (2026-02-27)
- When decomposed chat sections (`ChatTranscript`, `ChatComposerStack`, `ChatDiffPane`) need shared `useAgentChat` runtime state, a small local Zustand bridge (`chat-panel-controller-store`) lets leaf sections self-wire without reintroducing context providers or mega prop-drilling from `ChatPanel`.
- Zustand selector fallbacks must use stable module-level constants (arrays/functions) instead of inline `?? []` / `?? (() => {})`, otherwise React can warn about uncached `getSnapshot` values and trigger avoidable extra renders in tests/runtime.

### Task: AppWorkspace Decomposition (2026-02-27)
- For large renderer shell components, combining a local controller hook with a small context provider lets you split rendering into focused files without reintroducing prop-drilling complexity or duplicating hook subscriptions.
- For Zustand-driven workspace UIs, a cleaner long-term shape is often shell-only composition plus self-wired feature panels (`ChatPanel`, `SkillsPanel`, `Header`) that consume focused hooks/stores directly; this removes pass-through wrappers and keeps data ownership close to the feature surface.
- Repository-wide wrapper cleanup works best by targeting true prop-injection wrappers (components that only gather hooks and forward props) while preserving components that still own layout behavior (transitions, containers, panel boundaries).

### Task: App Shell Decomposition (2026-02-27)
- App-shell readability improves substantially when `App.tsx` only owns top-level routing/loading and delegates workspace wiring to dedicated app-shell components; this removes fragile prop-bundle indirection while preserving existing behavior and making future edits safer.

### Task: React Doctor + Pattern Style Remediation (2026-02-27)
- React Doctor component-size warnings can be resolved without behavior drift by splitting orchestration-heavy settings components into focused presentational subcomponents while keeping reducer/state logic centralized in the parent.
- `pnpm check` enforces the project’s branching-style rule (`choose`/`chooseBy`) across renderer code too; introducing `switch` reducers in UI components will fail CI-style gates even when typecheck/lint pass.
- Full-repo React Doctor audits in Electron codebases can be dominated by Knip dead-code noise (`knip/files`, `knip/exports`, `knip/types`) from multi-process entrypoints and runtime wiring; these should be explicitly ignored in `react-doctor.config.json` for stable, meaningful repository-level scores.

### Task: ConnectionsSection Composition Refactor (2026-02-27)
- Large renderer settings surfaces become easier to maintain and safer to refactor when split by responsibility (metadata, warnings, key-editor row, add-row, subscription row) under a co-located subfolder, keeping the top-level section component as orchestration-only composition.
- React Doctor `useState initialized from prop` warnings in form editors are resolved cleanly by syncing prop-derived editable state with `useEffect` rather than setting state during render.

### Task: Spec 02 API Key Plaintext Warning Completion (2026-02-27)
- Security warnings implemented in non-mounted/legacy settings components do not protect users in practice; warning paths for sensitive states (like unencrypted API keys) must live in the currently mounted settings surface (`SettingsPage` sections), not only in deprecated dialogs.
- For encrypted-storage migrations, detect plaintext vs encrypted payloads using the persisted storage format marker (`enc:v1:`) at read time; this enables safe one-shot auto-migration to encrypted values while still surfacing a deterministic user action (`manual re-save`) when encryption operations fail.

### Task: OpenAI Subscription Cloudflare 403 Fix (2026-02-26)
- OpenAI ChatGPT subscription OAuth tokens and OpenAI API keys require different transport endpoints: API-key traffic should use OpenAI API (`api.openai.com`), while Codex OAuth traffic should use ChatGPT Codex responses (`https://chatgpt.com/backend-api/codex/responses`); mixing them produces either Cloudflare challenge `403` or scope-based `401` (`api.responses.write`).
- Codex responses require `store=false` in request payloads; forcing this at transport level prevents endpoint incompatibility regressions when using generic OpenAI Responses adapters.
- ChatGPT Codex requests can fail with opaque `400` responses unless OpenClaw-style Codex headers are present (`chatgpt-account-id`, `OpenAI-Beta`, `originator`, and an explicit `User-Agent`) and the URL is normalized to `/backend-api/codex/responses` even when the upstream client posts to `/backend-api`. [SKILL?]
- ChatGPT Codex responses currently reject `max_output_tokens`; when reusing generic OpenAI Responses clients for subscription transport, strip unsupported params in the request-rewrite layer instead of relying on upstream SDK defaults.

### Task: Record-Unknown Cleanup Across Runtime Boundaries (2026-02-26)
- Replacing broad object validators in settings persistence with strict JSON-only schemas can silently drop valid provider records when nested `undefined` fields are present (common in `electron-store` defaults); use a recursive schema that explicitly allows `undefined` for settings-store hydration paths while keeping strict JSON schemas for pure JSON persistence.

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

### Task: Sub-Agent System — Full Agent Tool Parity (2026-03-02)
- The existing `AgentFeature.filterTools` hook (`runtime-types.ts:74`) was already defined and wired in `registry.ts` but never used by any feature — it's a ready-made extension point for per-agent-type tool restriction without modifying the core agent loop. [SKILL?]
- Splitting sub-agent context into two separate interfaces avoids circular concerns: `SubAgentToolContext` (minimal: agentId, agentName, teamId, permissionMode, depth — lives on `ToolContext`) for tool-level code, and `SubAgentRunContext` (full: adds toolFilter, systemPromptAddition) on `AgentRunContext` for the feature pipeline. Tools don't need to know about prompt fragments; features don't need tool context.
- Permission escalation prevention requires comparing parent and child modes at spawn time using a numeric restrictiveness ordering (`plan=0 < default=1 < acceptEdits=2 < dontAsk=3 < bypassPermissions=4`); children cannot exceed parent's level.
- `runAgent()` uses a hardcoded `MAX_ITERATIONS = 25` and doesn't accept `maxTurns` as a parameter — the spawn input's `maxTurns` field is forward-looking but currently has no effect. Declared but unused variables will fail Biome lint.
- Zod v4: `z.record(z.unknown())` requires two arguments — `z.record(z.string(), z.unknown())` — unlike v3 where the key schema defaulted to `z.string()`.
- When 6 parallel test-writing agents produce test files, expect import ordering and formatting violations that need a single `pnpm lint:fix` pass to clean up — agents don't share the same Biome config awareness.

### Task: Sub-Agent System — Hardening (2026-03-02)
- Task dependency cycle detection via DFS on the `blockedBy` graph is O(V+E) and handles self-cycles, 2-node, and 3-node cycles correctly. The `blocks` field is intentionally excluded from cycle checks — it's informational only and doesn't affect scheduling.
- Changing `updateTask` from `TaskRecord | null` to a discriminated union `UpdateTaskResult` (with `kind: 'not_found'` and `kind: 'cycle_detected'` variants) requires the tool layer to narrow via `'kind' in result` — but makes error conditions explicit and composable.
- A facade re-export module (`sub-agents/facade.ts`) eliminates lazy `await import(...)` in 7 tool files while preserving the genuine lazy import for `spawn-agent.ts` (which has a real circular dependency chain through `agent-loop → built-in-tools`).

### Task: Sub-Agent System — Integration Gap Closure (2026-03-02)
- The bridge pattern (`sub-agent-bridge.ts` wrapping `broadcastToWindows`) keeps IPC emission concerns out of business-logic modules (team-manager, task-board, sub-agent-runner), making those modules testable by mocking only the bridge instead of Electron's BrowserWindow.
- For sub-agent plan approval routing, team-bound sub-agents should route `proposePlan` through the message bus (to the team lead) rather than through the renderer. The `subscribe()` + `respondToPlan()` pattern in the runner function resolves pending plan proposals via the existing `plan-manager` promise infrastructure.
- Lazy team loading from disk (attempt `loadPersistedTeam` when `getTeam` returns undefined before throwing) keeps team state recoverable after app restart without requiring app-startup scanning of project directories. Loaded members are set to `status: 'shutdown'` since no agents are running.

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
