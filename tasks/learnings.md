---
name: project-learnings
description: Technical learnings log for OpenWaggle. Stores warnings, pattern preferences, and historical engineering learnings; workflow policy lives in AGENTS.md and CLAUDE.md.
owner: openwaggle-core
last_updated: 2026-03-20
---

# LEARNINGS.md

This document stores project-specific technical learnings only.

## 1) Active Warnings

- None currently.

## 2) Pattern Preferences

- Add only durable technical guidance that improves implementation quality.
- Do not add routine project-management notes unless they materially affect implementation behavior.

## 3) Recent Learnings

### TanStack useChat & Streaming Patterns
- `useChat` foreground flows can leave the renderer vulnerable to client/message resets. Cache final foreground `UIMessage[]`, restore once if empty, then clear the guard so persisted hydration resumes.
- `react-virtuoso` chat transcripts need stable `computeItemKey` when inserting user turns mid-stream. Index-based keys cause DOM recycling bugs.
- Snapshot-refresh barriers are needed for sends and steer flows. A stale `onRunCompleted` can overwrite optimistic user turns unless the send path increments an explicit deferral barrier synchronously.
- `ChatClient.sendMessage()` resolves only after the full stream completes, not after optimistic insertion. Safe to keep barriers open for the whole run.
- `for await (const chunk of stream)` blocks indefinitely on provider stalls. Use manual `iterator.next()` + `Promise.race` with a timeout.
- Stream-stall recovery should split "pending tool args" from "awaiting tool result". Retrying is safe during `TOOL_CALL_START`/`TOOL_CALL_ARGS`; unsafe after `TOOL_CALL_END` without result.
- `setMessages()` only accepts `UIMessage[]`, not a functional updater. Use a `messagesRef` pattern for IPC event listeners that need current state.
- `isLoading` can go `false` when `sendPromise` resolves even though main process still has an active run. Augment with `agentPhase !== null`.

### OAuth & Auth Patterns
- OAuth expiry should be stored as the provider's real `expiresAt` and buffered in exactly one place. Double-buffering silently shortens sessions.
- Background auth polling must not call the proactive refresh path. Lifecycle status should derive from stored token state only.
- Fatal refresh failures (HTTP 400/401) should clear the stored token immediately to stop retry loops.

### Approval & Tool Execution
- TanStack approval placeholder payloads (`{"approved":true,"pendingExecution":true}`) can flow as ordinary tool-result content. Both UI and logging must distinguish placeholders from concrete results.
- Pending-approval selection must use newest-unresolved semantics (reverse traversal + filter resolved IDs).
- Auto-trust checks must re-verify the approval is still current right before dispatching `respondToolApproval`.
- Duplicate pending approvals must be scoped to the current user turn — matching calls from earlier turns are legitimate new work.
- Trusted `runCommand` wildcard matching should reject shell-chain operators (`;`, `&&`, `||`, pipes) even when prefix patterns match.
- Approval overrides applied before context binding (e.g. `withoutApproval`) are lost unless `bindToolContextToTool()` explicitly preserves `needsApproval: false` on the bound server tool. Otherwise waggle/full-access runs can unexpectedly re-enter approval-required tool continuations. `[SKILL?]`

### Electron & Process Boundaries
- MCP stdio transports must use the same safe child-environment allowlist as command execution. Full `process.env` leaks API keys to MCP subprocesses.
- `StdioClientTransport.env` expects `Record<string, string>` but `process.env` values are `string | undefined`. Filter undefined entries.
- `@modelcontextprotocol/sdk` is ESM-only — add to `externalizeDeps.exclude` in electron-vite config.
- Chromium session DIPS database errors: fix with a versioned one-time profile repair before the first `BrowserWindow`.
- `better-sqlite3` in Electron needs explicit Electron-target rebuild. Keep a separate Node rebuild path for Vitest.
- Playwright E2E helpers should not forward full parent `process.env`. Use a small allowlist.
- E2E readiness checks should anchor on stable shell controls, not empty-state copy.
- `window.prompt`/`window.confirm` can be unsupported in Electron renderer contexts. Use in-app modals.

### React & Renderer Patterns
- `react-virtuoso` `followOutput="smooth"` during streaming causes visible jank. Use immediate follow while loading.
- Renderer cache layers only help when upstream lookup hooks preserve referential identity.
- Zustand selector fallbacks must use stable module-level constants, not inline `?? []`.
- Zustand mock selectors in tests must return stable function identities for function-valued slices, or effects retrigger infinitely.
- React Compiler checks fail on `try`/`finally` without `catch`. Rewrite to promise-chain cleanup.
- `@testing-library/react` auto-cleanup needs `globals: true` or explicit `afterEach(() => cleanup())`.
- Component test Vitest configs need `@vitejs/plugin-react` in plugins for JSX runtime.
- Thread-switch scroll persistence must not capture `scroller.scrollTop` from a conversation-change effect as the source of truth; by effect time, the DOM may already represent the incoming thread. Cache per-thread scroll position from scroll events and persist/flush that cache on switches.
- Chat thread navigation can deliver `activeConversationId` and `lastUserMessageId` on different renders. Treat the first non-null `lastUserMessageId` after a conversation switch as baseline (seen), or send-anchor logic will misfire and jump scroll on navigation.
- In real navigation hydration, `lastUserMessageId` can change multiple times (stale previous-thread ID, then interim, then final). Suppress user-anchor scroll until the conversation snapshot stabilizes for a short settle window; one-shot baseline suppression is insufficient.
- Navigation-time user-anchor suppression must still allow a genuine immediate send in the active thread. The safe discriminator is a stable per-thread baseline plus a fresh `isLoading` transition and a single-message append; a raw settle timeout alone will suppress legitimate send-anchor scrolls and fail E2E.

### IPC & Shared Types
- Shared IPC channel maps can generate preload helpers directly. Export channel arg/payload utility types for DRY preload.
- IPC channels should be scoped to specific actions, not generic path openers — renderer is untrusted.
- First-send UX depends on main-process persistence of the user turn even when the run fails before assistant output.
- `typedHandle` + `runAppEffectExit` is the pattern for invoke (request/response) IPC handlers. `typedOn` + `runAppEffect` is the pattern for send (fire-and-forget) IPC listeners. Both are Effect-based; raw Electron wrappers are internal (`rawHandle`/`rawOn`). Tests that mock `../../runtime` must include both `runAppEffectExit` and `runAppEffect`.
- `Effect.catchAll` only catches typed failures, not sync throws (defects). `decodeUnknownOrThrow` throws synchronously. Use `Effect.catchAllDefect` in addition to `Effect.catchAll` when wrapping code that may throw.

### Provider & Model System
- OpenAI subscription OAuth tokens and API keys need different transport endpoints. Mixing produces 403 or 401 errors.
- Codex responses require `store=false` and specific headers (`chatgpt-account-id`, `OpenAI-Beta`, `originator`).
- Anthropic rejects requests with both `temperature` and `top_p`. Provider-specific resolvers should emit only one.
- Provider model payloads can contain duplicates (especially Ollama). De-duplicate by `provider:modelId`.
- TanStack AI adapter factories (`createAnthropicChat`, `createOpenaiChat`) restrict model params to static literal unions. Wrap them in typed helper functions that use `as (typeof MODEL_LIST)[number]` casts internally — this keeps the suppression in one documented place and avoids scattering `@ts-expect-error` through provider code.
- Dynamic model fetching must also call `providerRegistry.indexModels()` so the agent loop's `getProviderForModel()` resolves dynamic IDs. Without indexing, the agent loop returns "No provider registered for model".
- Persisted dynamic `defaultModel` values should be re-associated from `enabledModels` before startup validation, and renderer boot should load settings before fetching provider models. Otherwise valid dynamic selections can be downgraded to the default model on launch before dynamic IDs are re-indexed.
- OpenAI subscription auth uses OAuth tokens (not `sk-` prefixed API keys). `fetchModels` should detect non-`sk-` keys and return static fallback models since the `/v1/models` endpoint requires API key auth.
- Claude 4.6 migration (per Anthropic docs): manual thinking (`{type: "enabled", budget_tokens}`) is deprecated. Use `thinking: {type: "adaptive"}` + `output_config: {effort: "..."}` on the GA endpoint (`client.messages.create`, not beta). Requires `@anthropic-ai/sdk` newer than 0.71.2 (which lacks these types). `[SKILL?]`
- Anthropic subscription OAuth is server-restricted to Claude Code only (policy enforced Feb 2026). Third-party apps get 400 for all models except haiku. The restriction uses a two-check system: (1) `anthropic-beta: oauth-2025-04-20` header, (2) system prompt must begin with `"You are Claude Code, Anthropic's official CLI for Claude."`. Without the magic prefix → haiku only. Full OAuth compatibility requires 4 elements: identity system prompt prefix (array format with `{type:"text"}` blocks), all 4 beta headers (`claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14`), `claude-cli/2.1.75` user-agent, and `mcp_`-prefixed tool names (stripped from responses via `content_block_start` events). Per OpenClaw/OpenCode reference implementations.
- Orchestration sub-runs (`model-runner.ts`) don't pass `systemPrompts` to `chat()` — they embed all context in the user message. When `systemPrompts` is absent, `mapCommonOptionsToAnthropic` produces `body.system` as `""`. The OAuth adapter must filter empty strings before building the system content-block array, or Anthropic rejects with `"system: text content blocks must be non-empty"`.
- Anthropic SDK `ClientOptions.apiKey` accepts `null | undefined` (skips `x-api-key` header), but TanStack's `AnthropicClientConfig` narrows to `apiKey: string`. When overriding `chatStream` with raw fetch, use a placeholder string — the SDK client is never used for requests.
- `processAnthropicStream` expects an `AsyncIterable` of parsed SSE event objects (e.g. `{ type: "content_block_delta", delta: {...} }`), NOT raw `ReadableStream<Uint8Array>` bytes from `fetch`. When using raw fetch instead of the SDK client, an SSE parser must bridge raw bytes → parsed JSON objects before feeding to `processAnthropicStream`.
- TanStack adapter private members (`client`, `mapCommonOptionsToAnthropic`, `processAnthropicStream`) are inaccessible in TS subclasses but accessible at runtime. Use type guard pattern: define an interface for the internal methods, validate with `'method' in adapter`, then bind and use. Avoids `as unknown as` casts.
- TanStack AI 0.6→0.8 upgrade: continuation chunks patch method renamed from `emitToolResults` to `buildToolResultChunks` and gained an additional `finishEvent` parameter. When porting patches across minor versions, inspect the new source structure first — function signatures and call sites may have changed even though the underlying bug remains.
- `@tanstack/ai-react@0.7.2` merged the messagesRef staleness fix upstream (PR #373). Always check upstream changelogs before porting patches — fixes may have landed.

### Persistence & Data
- Atomic JSON writers with fixed temp filenames are unsafe under concurrent writes. Use per-write unique temp filenames.
- Orchestration checkpoint fields must be added in four places together: engine snapshot, shared types, Zod schema, run-repository mapping.
- Conversation schema refactors: keep persisted JSON backward-compatible by making removed fields optional in Zod.

### Tool System
- Explicit per-run `ToolContext` binding is cleaner than ambient context services for TanStack server tools.
- `AgentFeature.filterTools` hook exists in `runtime-types.ts` — ready-made extension point for per-agent-type tool restriction.
- Tool result strings are treated as JSON-encoded payloads by TanStack AI. Use structured result contract (`kind: 'text' | 'json'`).
- `fast-glob` can match parent-directory patterns like `../*`. Validate glob inputs to confine file-discovery tools.

### Waggle Mode Patterns
- Waggle turns using `orchestrate` tools can exceed the 120s `STREAM_STALL_TIMEOUT_MS`. Waggle `runAgent` calls need a dedicated `stallTimeoutMs` override (e.g. 600s) passed through `AgentRunParams` → `processAgentStreamEffect`.
- During live waggle streaming, all turns flow into a single TanStack AI `UIMessage`. The metadata lookup must use `completedTurnMeta[0]` (not `currentAgentIndex`) for the first segment's metadata, since `currentAgentIndex` advances before the first `turn-end` event fires.
- Post-waggle standard messages inherit waggle styling when the conversation retains `waggleConfig` and the metadata lookup falls back to position-based derivation. Guard with `persistedMeta.size === 0` so only legacy conversations use position-based fallback.
- TanStack AI creates assistant `UIMessage`s from each unique `TEXT_MESSAGE_START.messageId`. For waggle turns with tool continuations, normalize `TEXT_MESSAGE_START/TEXT_MESSAGE_CONTENT/TEXT_MESSAGE_END` to one stable per-turn ID **before** emitting to both `waggle:stream-chunk` and `agent:stream-chunk`, or live metadata mapping drifts from rendered message IDs and causes turn mislabeling. `[SKILL?]`
- E2E waggle transcript fixtures should persist one assistant message per turn with message-level `metadata.waggle` for deterministic divider assertions. A single persisted assistant message with `_turnBoundary` parts is not a stable E2E proxy for live stream segmentation behavior (keep that coverage in unit tests around `splitAtTurnBoundaries`). `[SKILL?]`
- Persisted tool-call reconciliation executes repeatedly during live streaming; partial/malformed `tool-call.arguments` strings are expected transient states. Treat parse failures as non-errors in that hot path (no warning logs) to avoid console spam and renderer slowdown.

### Build & Tooling
- `react-doctor` defaults to changed-files-only on feature branches. Use `GIT_DIR=/nonexistent` for full-repo scans.
- Vitest `vi.mock()` factories are hoisted before top-level variables. Use `vi.hoisted(...)` for shared mock handles.
- Vite/Electron dev mode: patch changes under `node_modules` can be masked by stale `.vite/deps` prebundles. Use `optimizeDeps.force = true`.
- Playwright quick runs (`pnpm exec playwright test` / `test:e2e:headless:quick`) execute against the current built Electron artifacts. Rebuild first (`pnpm build`) when validating renderer behavior changes, or E2E can report stale results.

### Auto-Update & Release Pipeline
- `electron-updater` is a runtime dependency (not devDep) because it ships in the main process bundle. It has CJS exports so it works when externalized by electron-vite (no need to add to `externalizeDeps.exclude`).
- `GITHUB_TOKEN` pushes from workflows do NOT trigger other workflows. To chain version-bump → build → release, combine them in a single workflow with job dependencies rather than separate tag-triggered workflows.
- CalVer `YYYY.M.D` is valid semver (e.g. `2026.3.11`) but limits releases to one per day. Leading zeros (`2026.03.11`) are invalid semver.
- Conventional Commits can fully automate version bumps: `feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major. Skip version-bump commits via `if: "!startsWith(github.event.head_commit.message, 'chore(release):')"` to avoid infinite loops.

### Feedback & gh CLI Integration
- `gh` CLI uses keyring-stored OAuth credentials. Inherited `GITHUB_TOKEN`/`GH_TOKEN` env vars override keyring auth. Strip them for child process calls via `getGhCliEnv()`.
- `gh issue create` label flag fails silently if the label doesn't exist in the repo. Use try/retry-without-label pattern.

## 4) Old Learnings Archive

_(Archived items have been consolidated into the sections above. Historical task-specific details are available in git history.)_
