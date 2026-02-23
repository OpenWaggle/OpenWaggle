# Hardening Backlog

Concrete improvements and fixes not covered by existing specs (00–08).
Ordered by severity. Each item is independent unless noted.

---

## Critical

### H-01: Sandbox command execution after approval

**Problem**

`src/main/tools/tools/run-command.ts` passes the raw `command` string to `/bin/bash -lc` (line 67) after user approval. There is no validation, logging, or restriction on what can be executed. After the user clicks "approve," arbitrary commands run — including `curl | bash`, `rm -rf /`, or data exfiltration via `$(...)` subshells.

`getSafeChildEnv()` strips API keys from the environment (good), but that's the only protection layer.

**What exists**

- `needsApproval: true` on the tool definition (line 12)
- `getSafeChildEnv()` in `src/main/env.ts` filters sensitive env vars
- No command blocklist, no audit log, no output size guard beyond `maxBuffer: 1MB`

**What to do**

- [ ] Add structured logging for every command execution: tool name, full command string, working directory, exit code, duration. Use the existing `createLogger('tools:runCommand')` pattern.
- [ ] Add a blocklist of high-risk patterns that require a second confirmation or are outright denied:
  - `rm -rf /` or `rm -rf ~`
  - `curl ... | bash`, `wget ... | sh`
  - `chmod 777`
  - `> /dev/sda`, `dd if=`
  - `:(){ :|:& };:` (fork bomb)
- [ ] Log the first 1KB of stdout/stderr per execution for post-hoc debugging (redact if it matches known secret patterns).
- [ ] Consider adding a `--restricted` bash flag or using a restricted shell for sandbox mode, so shell builtins like `exec`, `enable`, and PATH modification are blocked.

**Files to touch**

- `src/main/tools/tools/run-command.ts` — blocklist check, logging
- `src/main/logger.ts` — add `tools:runCommand` namespace if needed

**Risk if skipped**: A compromised or hallucinating LLM can exfiltrate data or destroy the filesystem after a single user approval.

---

### H-02: API key plaintext fallback without user notification

**Problem**

`src/main/store/settings.ts:247` — when `safeStorage.isEncryptionAvailable()` returns false, `encryptApiKey()` silently stores the raw API key string in the electron-store config file. The only signal is a `logger.warn()` that the user will never see (it goes to the main process log, not the UI).

This can happen on: Linux without a keyring daemon, headless environments, VMs, CI runners.

**What exists**

- `encryptApiKey()` at line 245–253: falls back to plaintext on encryption unavailability
- `decryptApiKey()` at line 256–269: returns empty string if encryption is unavailable and key was encrypted (good), but doesn't handle the reverse case where key was stored in plaintext
- Logger warning at line 260 — invisible to users

**What to do**

- [ ] Add a `securityWarnings` field to `Settings` (or a separate IPC query `'settings:get-security-warnings'`).
- [ ] On settings load, check `safeStorage.isEncryptionAvailable()`. If false and any provider has a non-empty API key, include `'api-keys-unencrypted'` in the warnings array.
- [ ] In the renderer settings panel, show a visible warning banner: "Your API keys are stored unencrypted on this system. Install a keyring (e.g., gnome-keyring, kwallet) to enable encryption."
- [ ] Never silently store keys in plaintext without the user's awareness.

**Files to touch**

- `src/main/store/settings.ts` — add encryption availability check to settings getter
- `src/shared/types/settings.ts` — add `securityWarnings` to Settings or create new IPC channel
- `src/renderer/src/components/settings/` — render warning banner

**Risk if skipped**: API keys leak to disk in plaintext on affected systems. User has no idea.

---

### H-03: Unbounded conversation loading blocks main thread

**Problem**

`src/main/store/conversations.ts:188` — `listConversations()` reads every `.json` file in the conversations directory via `Promise.all()` with no pagination or concurrency limit. Each file is fully read, JSON-parsed, and Zod-validated.

For a user with 200+ conversations, this means 200 concurrent `readFile` calls, 200 `JSON.parse` calls, and 200 Zod validations — all on startup, all unbounded.

**What exists**

- `listConversations()` at line 183–217: `Promise.all(files.map(async ...))` — no limit
- Returns `ConversationSummary[]` which only needs `id`, `title`, `projectPath`, `messageCount`, `createdAt`, `updatedAt` — the full message array is parsed and discarded

**What to do**

- [ ] **Option A (recommended)**: Store a lightweight `index.json` in the conversations directory with summary metadata. Update it atomically on save/delete. `listConversations()` reads only the index file. Fall back to full scan if index is missing or corrupt.
- [ ] **Option B**: Read only the first ~500 bytes of each file (enough for the top-level fields before `messages`), or use a streaming JSON parser that extracts metadata without parsing the full message array.
- [ ] **Option C (minimum)**: Add concurrency limiting — process at most 10 files in parallel using a simple semaphore. This doesn't fix the fundamental O(n) problem but prevents I/O exhaustion.
- [ ] Whichever option: add a `limit` parameter to `listConversations(limit?: number)` for future pagination support.

**Files to touch**

- `src/main/store/conversations.ts` — `listConversations()`, `saveConversation()`, `deleteConversation()`
- `src/shared/types/ipc.ts` — optionally add `limit` param to `'conversations:list'`

**Risk if skipped**: App startup degrades linearly with conversation count. At 500+ conversations, expect multi-second freezes on the main thread.

---

## High

### H-04: Settings store has no error recovery

**Problem**

`src/renderer/src/stores/settings-store.ts:42-49` — both `loadSettings()` and `loadProviderModels()` are fire-and-forget async calls. If the IPC call throws (main process crash, IPC timeout, serialization error), the promise rejects silently. `isLoaded` never becomes `true`. The UI hangs indefinitely on whatever loading state depends on `isLoaded`.

**What exists**

- `loadSettings()` at line 42–45: `await api.getSettings()` with no try-catch, no error state
- `loadProviderModels()` at line 47–49: same pattern
- `isLoaded: false` as initial state — never set to `true` on failure
- No retry mechanism

**What to do**

- [ ] Add `loadError: string | null` to `SettingsState`.
- [ ] Wrap `loadSettings()` and `loadProviderModels()` in try-catch. On failure: set `isLoaded: true` (to unblock UI) and `loadError` to the error message.
- [ ] In the renderer, check `loadError` and show a retry banner: "Failed to load settings. [Retry]"
- [ ] Add a `retryLoad()` action that clears the error and re-attempts.

**Files to touch**

- `src/renderer/src/stores/settings-store.ts` — add error state, wrap async calls
- `src/renderer/src/components/settings/` — render error/retry UI

**Risk if skipped**: Any IPC failure on startup permanently freezes the settings UI with no recovery path.

---

### H-05: Pin TanStack AI and Transformers dependency versions

**Problem**

`package.json:45-53` — all `@tanstack/ai-*` packages use `^0.5.x` ranges. These are pre-1.0 libraries where semver `^` allows any `0.x` minor bump, which in pre-1.0 semver can contain breaking changes. The TanStack AI core and provider adapters can update independently, breaking adapter compatibility silently.

Same issue with `@xenova/transformers@^2.17.2` — rapidly evolving, breaking changes common.

**What exists**

- `@tanstack/ai`: `^0.5.0`
- `@tanstack/ai-anthropic`: `^0.5.0`
- `@tanstack/ai-openai`: `^0.5.0`
- etc. — all `^0.5.x`
- `@xenova/transformers`: `^2.17.2`

**What to do**

- [ ] Pin all `@tanstack/ai-*` packages to exact versions (e.g., `"0.5.0"` not `"^0.5.0"`).
- [ ] Pin `@xenova/transformers` to exact version.
- [ ] Add a Renovate/Dependabot config or a monthly manual update cadence so pins don't rot.
- [ ] Document the pinning rationale in `package.json` or CLAUDE.md.

**Files to touch**

- `package.json` — change version ranges to exact pins

**Risk if skipped**: A `pnpm update` or fresh install pulls a breaking TanStack minor version, causing silent adapter failures or type mismatches.

---

### H-06: Replace archived/unmaintained dependencies

**Problem**

Two dependencies for attachment processing are effectively abandoned:

- `mammoth@1.11.0` — DOCX-to-HTML converter. Last release: 2021. Repository archived on GitHub. No security patches.
- `pdf-parse@1.1.1` — PDF text extraction. Last release: 2019. Depends on an old `pdfjs-dist`. No security patches.

Both process untrusted user-uploaded files, making them security-sensitive.

**What exists**

- `mammoth` used in `src/main/ipc/attachments-handler.ts` for DOCX extraction
- `pdf-parse` used in the same file for PDF text extraction
- Both are in `dependencies` (not dev)

**What to do**

- [ ] Replace `pdf-parse` with `unpdf` (actively maintained, uses latest pdf.js) or `pdfjs-dist` directly.
- [ ] Replace `mammoth` with `docx-preview` or `libreoffice-convert` for DOCX extraction. Alternatively, accept DOCX as raw text extraction only (mammoth's HTML conversion is overkill if you just need text).
- [ ] If replacement is deferred, document the risk in CLAUDE.md and pin exact versions to prevent accidental upgrades to forks.

**Files to touch**

- `package.json` — swap dependencies
- `src/main/ipc/attachments-handler.ts` — update import and API calls

**Risk if skipped**: Known vulnerabilities in PDF/DOCX parsing with no upstream fixes. Processing untrusted files with archived libraries is a security liability.

---

### H-07: Whisper transcription model never freed from memory

**Problem**

`src/main/ipc/voice-handler.ts:66` — `transcriberPromises` caches loaded Whisper models indefinitely. Once a user records a single voice clip, the ONNX model (~80–200MB depending on tiny vs. base) stays in memory for the entire app session.

**What exists**

- `transcriberPromises` at line 66: `Partial<Record<VoiceModel, Promise<WhisperTranscriber>>>`
- Models are loaded on first use (line 118–153) and cached
- `resetVoiceHandlerForTests()` at line 155 deletes entries — test-only, not exposed to runtime
- No eviction timer, no memory pressure detection

**What to do**

- [ ] Add an idle eviction timer: after 5–10 minutes of no transcription calls, delete the cached model reference and let GC reclaim the memory.
- [ ] Track `lastUsedAt` per model. On each transcription call, reset the timer.
- [ ] On eviction, log the model being freed: `logger.info('Evicting idle Whisper model', { model })`.
- [ ] Optionally expose a `'voice:unload-model'` IPC channel so the renderer can proactively free memory (e.g., when the user closes the voice panel).

**Files to touch**

- `src/main/ipc/voice-handler.ts` — add eviction timer logic

**Risk if skipped**: Long-running sessions waste 80–200MB of RAM on an idle model. Users who try voice once and never use it again pay the memory cost forever.

---

## Medium

### H-08: Extract duplicated broadcast and path utilities

**Problem**

The window broadcast pattern is duplicated in `src/main/utils/stream-bridge.ts` (lines 11–19, 23–28) and `src/main/ipc/terminal-handler.ts`:

```typescript
for (const win of BrowserWindow.getAllWindows()) {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}
```

Similarly, `isPathInside()` exists in `src/main/tools/define-tool.ts:103-106` and is reimplemented in `src/main/ipc/attachments-handler.ts` with slightly different logic.

**What to do**

- [ ] Extract `broadcastToWindows(channel: string, payload: unknown)` into `src/main/utils/ipc-broadcast.ts`. Replace all inline loops.
- [ ] Extract `isPathInside()` into `src/shared/utils/paths.ts` (or `src/main/utils/paths.ts` if Node-only). Remove duplicate implementations.
- [ ] Add unit tests for both utilities.

**Files to touch**

- `src/main/utils/ipc-broadcast.ts` (new)
- `src/main/utils/stream-bridge.ts` — use shared broadcast
- `src/main/ipc/terminal-handler.ts` — use shared broadcast
- `src/main/tools/define-tool.ts` — use shared `isPathInside`
- `src/main/ipc/attachments-handler.ts` — use shared `isPathInside`

**Risk if skipped**: Bug fixes in one copy don't propagate to the other. Inconsistent path validation between tools and attachments.

---

### H-09: Add tool execution audit logging

**Problem**

`src/main/tools/define-tool.ts:72-93` — tool args are validated via Zod at line 73 but never logged. Tool results are returned but not logged. When a tool fails, there's no record of what args were passed, what the tool returned, or how long it took.

**What to do**

- [ ] Add `createLogger('tools')` to `define-tool.ts`.
- [ ] Before calling `config.execute()`, log: tool name, arg keys (not full values — they may contain file contents), timestamp.
- [ ] After execution, log: tool name, result kind (`text`/`json`), duration in ms, whether it was truncated.
- [ ] On failure, log: tool name, error message, duration. Don't log full args on error (may contain secrets or large payloads) — log arg keys and sizes only.

**Files to touch**

- `src/main/tools/define-tool.ts` — add logging around execute

**Risk if skipped**: Tool failures are black boxes. Debugging requires reproducing the exact agent conversation that triggered the failure.

---

### H-10: Preserve error stack traces across IPC

**Problem**

`src/main/utils/stream-bridge.ts:16` — when a `RUN_ERROR` stream chunk is serialized for IPC, the Error object is destructured to `{ message: chunk.error.message }`. Stack traces, error names, and any custom properties are lost. The renderer only sees a flat string.

**What to do**

- [ ] Change the serialization to include `name` and `stack`:
  ```typescript
  const serializable = chunk.type === 'RUN_ERROR'
    ? { ...chunk, error: { message: chunk.error.message, name: chunk.error.name, stack: chunk.error.stack } }
    : chunk
  ```
- [ ] In the renderer error display, show the stack trace in an expandable section (collapsed by default).
- [ ] This is complementary to spec-03 (fix error messages) but is a targeted fix that can land independently.

**Files to touch**

- `src/main/utils/stream-bridge.ts` — expand error serialization
- `src/renderer/src/components/chat/ChatErrorDisplay.tsx` — optionally show stack

**Risk if skipped**: Provider errors, tool crashes, and agent loop failures are reported as flat strings with no actionable debug info.

---

### H-11: Debounce and cache git status checks

**Problem**

`src/main/ipc/git/shared.ts:8` defines `DIFF_GIT_MAX_BUFFER = 32MB`. The `git:status` and `git:diff` IPC handlers call git commands with this buffer on every invocation. There's no debouncing — rapid UI refreshes (e.g., after a file save) fire multiple concurrent git processes with 32MB buffer allocations.

**What to do**

- [ ] Add a 2-second debounce to `git:status` responses. Cache the last result and return it for repeat calls within the window.
- [ ] Invalidate the cache on `git:commit` or when the renderer explicitly requests a refresh.
- [ ] Reduce `DIFF_GIT_MAX_BUFFER` to 8MB or 16MB — 32MB is excessive for status checks. If the diff exceeds the buffer, truncate with a "diff too large" message rather than allocating more memory.
- [ ] Consider splitting `git:diff` into `git:diff-summary` (stat only, small buffer) and `git:diff-full` (full patch, large buffer, on-demand).

**Files to touch**

- `src/main/ipc/git/shared.ts` — reduce buffer constant
- `src/main/ipc/git/status-handler.ts` — add debounce/cache layer
- `src/main/ipc/git/diff-handler.ts` — optionally split into summary/full

**Risk if skipped**: Large repos with binary changes cause repeated 32MB allocations on every status poll. Degrades responsiveness.

---

### H-12: Remove dead `dialog:confirm` IPC channel

**Problem**

`src/shared/types/ipc.ts:188-191` defines a `'dialog:confirm'` invoke channel. A handler exists in `src/main/ipc/project-handler.ts`. The `OpenHiveApi` exposes `showConfirm()`. But no renderer code ever calls `api.showConfirm()` — the channel is dead code.

**What to do**

- [ ] Verify with a project-wide grep that `showConfirm` and `dialog:confirm` have zero renderer call sites.
- [ ] If confirmed dead: remove `'dialog:confirm'` from `IpcInvokeChannelMap`, remove `showConfirm` from `OpenHiveApi`, remove the handler registration, remove the preload binding.
- [ ] If it was intended for future use (e.g., spec-01 approval flow): add a `// TODO: used by spec-01` comment and leave it.

**Files to touch**

- `src/shared/types/ipc.ts` — remove or annotate
- `src/main/ipc/project-handler.ts` — remove handler
- `src/preload/api.ts` — remove binding
- `src/renderer/src/lib/ipc.ts` — remove if exposed there

**Risk if skipped**: Dead code adds confusion. Minimal severity but free to fix.

---

## Strategic (Quality of Life)

### H-13: Add pre-commit hook for typecheck + lint

**Problem**

`pnpm check` runs `typecheck + lint` but there's no pre-commit hook enforcing it. Type errors and lint violations can be committed and only caught later (or never, if CI isn't running).

**What to do**

- [ ] Add `lint-staged` + `husky` (or `lefthook` for a lighter alternative).
- [ ] Pre-commit: run `biome check --staged` on staged files only (fast).
- [ ] Optionally: run `pnpm typecheck` as a pre-push hook (slower, but catches type errors before they hit remote).
- [ ] Add `.husky/` or `lefthook.yml` to the repo.

**Files to touch**

- `package.json` — add dev dependencies, lint-staged config
- `.husky/pre-commit` or `lefthook.yml` (new)

**Risk if skipped**: Type errors and lint violations accumulate in commits. Low severity for solo dev, higher if contributors join.

---

### H-14: Write an agent loop integration test

**Problem**

The highest-risk code path — user sends message, agent loop streams response, tool calls execute, results return — has no integration test that exercises the full pipeline with a mock provider. Individual pieces are tested (stream collection, tool definitions, stores) but the end-to-end flow is not.

**What to do**

- [ ] Create `src/main/agent/__tests__/agent-loop.integration.test.ts`.
- [ ] Mock a provider that returns a canned tool-call stream (e.g., `readFile` call, then text response).
- [ ] Assert: tool executes with correct args, result feeds back into stream, final message contains expected text, events are emitted in correct order.
- [ ] Add a second test case: provider returns an error mid-stream. Assert: error event is emitted, conversation state is consistent.
- [ ] Add a third test case: user cancels mid-stream via AbortSignal. Assert: stream stops, no dangling promises.

**Files to touch**

- `src/main/agent/__tests__/agent-loop.integration.test.ts` (new)
- May need a test helper to create a mock `ProviderDefinition`

**Risk if skipped**: Regressions in the core agent loop are caught only by manual testing. This is the single most valuable test the project could have.

---

### H-15: Write a README

**Problem**

The project has 14k of CLAUDE.md and no README.md. There is no entry point for a human to understand what this project is, how to install it, or how to run it.

**What to do**

- [ ] Create `README.md` with:
  - One-paragraph description of what OpenHive is
  - Screenshot or GIF of the app
  - Prerequisites (Node, pnpm, platform requirements)
  - Install + run instructions (`pnpm install && pnpm dev`)
  - Brief architecture overview (link to CLAUDE.md for details)
  - Link to specs/ for roadmap
  - License

**Files to touch**

- `README.md` (new)

**Risk if skipped**: No one outside the author can evaluate, use, or contribute to the project.

---

## Gaps Not Covered by Specs or Existing Backlog

The following items were identified during a full codebase audit. They are ordered by
risk and grouped by theme. None overlap with specs 00–08.

---

### H-16: Test depth is critically thin

**Problem**

53 test files produce only 66 passing tests — an average of 1.2 tests per file. Many test files contain a single happy-path assertion. The most critical code paths (agent loop, tool approval flow, conversation persistence, streaming rendering) have shallow coverage. H-14 proposes one agent loop integration test, but the problem is systemic.

**What to do**

- [ ] Audit test files with ≤2 tests. For each, add edge cases: invalid input, error paths, cancellation, empty state.
- [ ] Priority targets by blast radius:
  - `src/main/agent/` — stream interruption, provider errors, tool approval timeout, multi-turn continuation
  - `src/main/store/conversations.ts` — corrupt JSON, concurrent read/write, migration edge cases
  - `src/main/tools/define-tool.ts` — output truncation, Zod validation failures, context unavailable
  - `src/renderer/src/stores/chat-store.ts` — rapid state transitions, race conditions between streaming and user actions
- [ ] Set a coverage floor: 60% line coverage as a starting gate, enforced in CI.
- [ ] Add `pnpm test:coverage` to the pre-push hook (once H-13 ships).

**Risk if skipped**: Regressions ship silently. The current test suite catches trivial breakage but misses any subtle state or timing bug.

---

### H-17: Electron security defaults are not verified

**Problem**

Electron apps have a long history of security misconfigurations. The project uses `contextBridge` (good), but there's no documented verification of:

- `nodeIntegration: false` on the renderer BrowserWindow
- `contextIsolation: true`
- `sandbox: true` on the renderer
- `webSecurity: true`
- Content Security Policy (CSP) headers restricting `script-src`, `connect-src`, `img-src`
- `allowRunningInsecureContent: false`

If any of these are misconfigured, the renderer has full Node.js access, and any XSS in markdown rendering (H-20) escalates to arbitrary code execution.

**What to do**

- [ ] Audit `src/main/index.ts` (or wherever `BrowserWindow` is created) for all `webPreferences` settings. Verify and document each.
- [ ] Add a CSP meta tag or `session.defaultSession.webRequest.onHeadersReceived` handler that sets `Content-Security-Policy` with:
  - `script-src 'self'`
  - `connect-src 'self' ws://localhost:*` (for devtools)
  - `img-src 'self' data:` (for inline images)
  - `style-src 'self' 'unsafe-inline'` (Tailwind needs inline styles)
- [ ] Add a startup assertion in main process that verifies `nodeIntegration === false` and `contextIsolation === true` at runtime.
- [ ] Document the security posture in CLAUDE.md under a "Security" section.

**Files to touch**

- `src/main/index.ts` — BrowserWindow creation, CSP header
- `CLAUDE.md` — document security settings

**Risk if skipped**: A single XSS vulnerability in markdown rendering gives an attacker (or a hallucinating LLM crafting malicious output) full Node.js access — file system, shell, network.

---

### H-18: IPC invoke calls have no timeout or recovery on renderer side

**Problem**

Every `api.*` call from the renderer is an `ipcRenderer.invoke()` that returns a Promise. If the main process hangs (long tool execution, provider timeout, deadlock), the Promise never resolves. The renderer waits indefinitely. There is no global timeout wrapper, no abort mechanism, and no UI indicator that an IPC call is stalled.

This is separate from H-04 (settings load failure) — that's about error handling. This is about indefinite hangs.

**What to do**

- [ ] Add a `withTimeout(promise, ms, label)` utility in `src/preload/api.ts` or `src/renderer/src/lib/ipc.ts`.
- [ ] Wrap all `ipcRenderer.invoke()` calls with a default timeout (30s for most, 120s for agent operations).
- [ ] On timeout: reject with a typed `IpcTimeoutError` so the renderer can show a "Request timed out — retry?" UI.
- [ ] For agent streaming: the stream itself has heartbeats (chunks arriving). Add a stall detector that fires if no chunk arrives for 60s.

**Files to touch**

- `src/preload/api.ts` or `src/renderer/src/lib/ipc.ts` — timeout wrapper
- `src/renderer/src/components/chat/ChatPanel.tsx` — stall detection UI

**Risk if skipped**: Any main-process hang freezes the entire UI with no recovery. The user must force-quit the app.

---

### H-19: No conversation backup or corruption recovery

**Problem**

Conversations are stored as individual JSON files in `{userData}/conversations/{id}.json`. If a file is corrupted (partial write during crash, disk full, OS kill during save), that conversation is lost. `loadConversation()` has Zod validation that will reject corrupt JSON, but there's no backup, no recovery, and no user notification beyond a thrown error.

**What to do**

- [ ] On `saveConversation()`: write to a `.tmp` file first, then `rename()` atomically. This prevents partial writes from corrupting the canonical file.
- [ ] Keep one previous version as `{id}.json.bak` (rotated on each save). On load failure, attempt to load the `.bak` file.
- [ ] On load failure with no backup: surface a clear error to the user ("Conversation X is corrupted and could not be recovered") rather than silently dropping it from the list.
- [ ] Log all save/load failures with file path and error details.

**Files to touch**

- `src/main/store/conversations.ts` — atomic write, backup rotation, recovery

**Risk if skipped**: App crash during a save permanently destroys the conversation. Users lose work with no explanation.

---

### H-20: LLM output rendered as markdown without sanitization

**Problem**

`react-markdown` in `MessageBubble.tsx` and `StreamingText.tsx` renders LLM output directly. While `react-markdown` doesn't render raw HTML by default (it uses `remarkParse` which strips HTML), the `rehype-highlight` plugin processes code blocks. If `rehypeRaw` or `dangerouslySetInnerHTML` is ever added (or a plugin introduces HTML passthrough), LLM-generated output could inject scripts.

Additionally, markdown link rendering (`[click here](javascript:alert(1))`) may not be filtered.

**What to do**

- [ ] Verify that `react-markdown` is configured without `rehypeRaw` or any HTML passthrough plugin. Document this as a security invariant.
- [ ] Add `rehype-sanitize` to the plugin chain as defense-in-depth. This explicitly strips any HTML that makes it through the remark pipeline.
- [ ] Filter `javascript:`, `data:text/html`, and `vbscript:` URL schemes in rendered links. `react-markdown` may already do this — verify and add a test.
- [ ] Add a test that renders known XSS payloads (`<img onerror=...>`, `[x](javascript:...)`, `` ```<script>``` ``) and asserts no executable content in the DOM.

**Files to touch**

- `src/renderer/src/components/chat/MessageBubble.tsx` — add `rehype-sanitize`
- A new test file for XSS payload rendering

**Risk if skipped**: A prompt injection attack that produces malicious markdown could execute JavaScript in the renderer. Combined with missing CSP (H-17), this escalates to full system access.

---

### H-21: Provider failure mid-stream has no retry or graceful degradation

**Problem**

`src/main/agent/agent-loop.ts` iterates the provider's `AsyncIterable<StreamChunk>` stream. If the provider throws mid-stream (network timeout, rate limit, 500 error), the error propagates as a `RUN_ERROR` event and the run ends. There is no retry, no partial-result recovery, and no fallback to another provider.

For transient failures (rate limits, network blips), this means the user loses the entire response and must manually resend.

**What to do**

- [ ] Detect retryable errors (HTTP 429, 500, 502, 503, network timeout) vs. permanent errors (401, 403, 400).
- [ ] For retryable errors: retry up to 2 times with exponential backoff (1s, 4s). Emit a `retrying` event so the renderer can show "Provider error, retrying...".
- [ ] For rate limits (429): parse `Retry-After` header if available; otherwise back off 10s.
- [ ] After max retries: emit `RUN_ERROR` as today. No change to the terminal path.
- [ ] Don't retry if the user has cancelled (check AbortSignal before each retry).

**Files to touch**

- `src/main/agent/agent-loop.ts` — retry wrapper around stream iteration
- `src/shared/types/agent.ts` — add `retrying` event type (optional)
- `src/renderer/src/components/chat/ChatPanel.tsx` — show retry indicator (optional)

**Risk if skipped**: Every transient provider error kills the entire agent run. Users manually retry, losing context and patience.

---

### H-22: No app crash recovery for in-flight agent runs

**Problem**

If the Electron app crashes or is force-quit during an active agent run, the in-flight streaming state is lost entirely. The conversation may be partially saved (if `saveConversation` was called during streaming), but the user sees an incomplete response with no indication that the run was interrupted. There is no "resume" or "this run was interrupted" signal.

**What to do**

- [ ] On agent run start, write a `{conversationId}.lock` file with `{ startedAt, modelId, lastChunkAt }`.
- [ ] On normal run completion (finished or error), delete the lock file.
- [ ] On app startup, scan for orphaned lock files. For each:
  - Load the conversation and check if the last message is incomplete (assistant message with no terminal event).
  - Show a banner: "A previous run was interrupted. The last response may be incomplete."
- [ ] Optionally: offer a "Continue" button that resends the last user message.

**Files to touch**

- `src/main/agent/agent-loop.ts` — lock file write/delete
- `src/main/store/conversations.ts` — orphan detection on startup
- `src/renderer/src/components/chat/ChatPanel.tsx` — interrupted run banner

**Risk if skipped**: Users see half-finished responses with no explanation. They don't know if the agent is still running, crashed, or finished.

---

### H-23: Feature surface area audit — defer non-core features

**Problem**

This is not a bug — it's a strategic concern. The v0.1 ships with: voice input (Whisper), OCR (tesseract.js), DOCX parsing (mammoth), PDF extraction (pdf-parse), xterm terminal, diff panel, skills system, orchestration pipeline, and 6 LLM providers. Each is a maintenance surface. None of them are the product differentiator (multi-agent).

The risk is not that these features are bad — they're well-built. The risk is that maintaining them consumes time that should go to spec 00.

**What to do**

- [ ] Categorize every feature as "core for multi-agent MVP" or "defer."
- [ ] For deferred features: don't remove them, but stop investing in them. No bug fixes, no enhancements, no tests. If they break, disable them behind a flag.
- [ ] Suggested core set for multi-agent MVP: agent loop, tool system, provider registry (2-3 providers, not 6), conversation persistence, basic chat UI. Everything else is gravy.
- [ ] Add a `FEATURE_FLAGS` constant (or settings toggle) that allows disabling voice, OCR, orchestration, terminal, and diff panel. This makes it easy to ship a focused MVP and re-enable features later.

**Risk if skipped**: Attention dilution. Every hour spent on voice input bugs or diff panel polish is an hour not spent on the only feature that makes OpenHive worth existing.
