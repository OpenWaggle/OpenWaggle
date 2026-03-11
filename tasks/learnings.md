---
name: project-learnings
description: Technical learnings log for OpenWaggle. Stores warnings, pattern preferences, and historical engineering learnings; workflow policy lives in AGENTS.md and CLAUDE.md.
owner: openwaggle-core
last_updated: 2026-03-11
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

### Persistence & Data
- Atomic JSON writers with fixed temp filenames are unsafe under concurrent writes. Use per-write unique temp filenames.
- Orchestration checkpoint fields must be added in four places together: engine snapshot, shared types, Zod schema, run-repository mapping.
- Conversation schema refactors: keep persisted JSON backward-compatible by making removed fields optional in Zod.

### Tool System
- Explicit per-run `ToolContext` binding is cleaner than ambient context services for TanStack server tools.
- `AgentFeature.filterTools` hook exists in `runtime-types.ts` — ready-made extension point for per-agent-type tool restriction.
- Tool result strings are treated as JSON-encoded payloads by TanStack AI. Use structured result contract (`kind: 'text' | 'json'`).
- `fast-glob` can match parent-directory patterns like `../*`. Validate glob inputs to confine file-discovery tools.

### Build & Tooling
- `react-doctor` defaults to changed-files-only on feature branches. Use `GIT_DIR=/nonexistent` for full-repo scans.
- Vitest `vi.mock()` factories are hoisted before top-level variables. Use `vi.hoisted(...)` for shared mock handles.
- Vite/Electron dev mode: patch changes under `node_modules` can be masked by stale `.vite/deps` prebundles. Use `optimizeDeps.force = true`.

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
