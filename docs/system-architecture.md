# System Architecture

This document describes OpenWaggle's architecture as it exists. It is descriptive, not prescriptive.

---

## Overview

OpenWaggle is an Electron desktop application structured as three OS-level processes that communicate through typed IPC channels. The main process runs an AI agent loop that calls LLM providers and executes tools on the local machine. The renderer process presents a chat interface. A preload script bridges the two with a fixed API surface. A shared type package defines the contract between all three.

```
+---------------------------------------------------------+
|                     Electron Shell                      |
|                                                         |
|  +------------+    contextBridge    +---------------+   |
|  |    Main    |<------------------->|    Preload    |   |
|  |  (Node.js) |    IPC channels     |    (Bridge)   |   |
|  +-----+------+                     +-------+-------+   |
|        |                                    |            |
|        |         +-------------+            |            |
|        |         |   Shared    |            |            |
|        |         |   Types     |            |            |
|        |         +-------------+            |            |
|        |                                    |            |
|        |    window.api      +---------------+--+         |
|        +--------------------+    Renderer      |         |
|           stream events     |    (React)       |         |
|                             +------------------+         |
+---------------------------------------------------------+
          |                            |
          | HTTP/SDK                   | stdio/SSE/HTTP
          v                            v
   +-------------+             +-------------+
   |     LLM     |             |     MCP     |
   |  Providers   |             |   Servers   |
   +-------------+             +-------------+
```

---

## Process Boundaries

### Main Process (`src/main/`)

Node.js process. Owns the agent loop, tool execution, persistence, provider connections, MCP server management, authentication, and all IPC handler registration. Built by electron-vite as CJS with ESM interop.

### Preload (`src/preload/`)

Bridge process. Exposes a typed `api` object to the renderer via `contextBridge.exposeInMainWorld()`. Every method is a thin wrapper mapping a friendly name to an IPC channel. Contains no business logic.

### Renderer (`src/renderer/src/`)

Chromium process. React 19 application with Zustand state management, Tailwind v4 styling, and TanStack AI/Query integration. Communicates with main exclusively through `window.api`.

### Shared Types (`src/shared/`)

Not a process. A TypeScript package imported by all three targets. Contains the IPC channel maps, branded types, domain types, validation utilities, and error classification. Defines the contract but executes no logic at runtime.

---

## Main Process Modules

### Entry and Lifecycle (`index.ts`, `runtime.ts`)

`index.ts` is the Electron entry point. On app ready, it initializes in order: runtime paths, file logger, token store, settings, provider registration, IPC handlers, BrowserWindow creation with secure web preferences, CSP header installation, auto-updater, and MCP manager. On quit, it disconnects MCP servers and cleans up resources.

`runtime.ts` composes an Effect `ManagedRuntime` from a layered service graph. This is the bridge from Electron callbacks into Effect's runtime.

### Effect Services (`services/`)

| Service | File | Responsibility |
|---|---|---|
| DatabaseService | `database-service.ts` | SQLite connection, migrations, SQL client |
| SettingsService | `settings-service.ts` | Settings CRUD interface |
| ProviderRegistryService | `provider-registry-service.ts` | Provider lookup by model ID |
| LoggerService | `logger-service.ts` | Structured logging |
| TeamRuntimeState | `team-runtime-state.ts` | Sub-agent team persistence |

These compose into `AppLayer`, the single Effect layer that all IPC handlers run against.

### IPC Handlers (`ipc/`)

22 handler modules register channels for specific domains:

| Handler | Domain |
|---|---|
| `agent-handler.ts` | Agent execution, streaming, cancellation |
| `conversations-handler.ts` | Conversation CRUD |
| `settings-handler.ts` | Settings read/write |
| `providers-handler.ts` | Provider models, API key testing |
| `auth-handler.ts` | OAuth flows, subscription management |
| `git/status-handler.ts` | Git status, diff |
| `git/branches-handler.ts` | Branch CRUD, checkout, upstream |
| `git/commit-handler.ts` | Git commit |
| `mcp-handler.ts` | MCP server lifecycle |
| `skills-handler.ts` | Skill listing, enable/disable, preview |
| `teams-handler.ts` | Team preset CRUD |
| `orchestration-handler.ts` | Orchestration run management |
| `terminal-handler.ts` | PTY session lifecycle |
| `waggle-handler.ts` | Multi-agent collaboration |
| `attachments-handler.ts` | File attachment preparation |
| `voice-handler.ts` | Local Whisper transcription |
| `feedback-handler.ts` | Bug report submission |
| `project-handler.ts` | Project folder selection, trust patterns |
| `shell-handler.ts` | External URL opening |
| `updater-handler.ts` | Auto-update checks and install |
| `devtools-handler.ts` | DevTools event bus config |
| `composer-handler.ts` | File suggestion for composer |

`typed-ipc.ts` provides `typedHandle<C>()` and `typedOn<C>()` wrappers that enforce channel map signatures and translate Effect failures into IPC error responses.

### Agent Loop (`agent/agent-loop.ts`)

The core execution engine. Entry point is `runAgentEffect(params: AgentRunParams): Effect<AgentRunResult>`.

**Constants:**
- `MAX_ITERATIONS = 25` (hard ceiling per run)
- `MAX_STALL_RETRIES = 2`
- `STALL_RETRY_DELAY_MS = 2000`

**Per-iteration cycle:**
1. Resolve project config from `.openwaggle/config.toml`
2. Resolve provider, validate API key, resolve quality config
3. Load standards (agents, skills) from project
4. Build `AgentRunContext` (conversation, payload, tool context, features, hooks)
5. Assemble system prompt from feature prompt fragments
6. Convert conversation history to chat format
7. Collect tools from active features, apply feature-level filters
8. Call LLM via TanStack AI `chat()` function
9. Process `AsyncIterable<StreamChunk>` through `StreamPartCollector`
10. Handle tool calls: check approval, execute, emit results
11. Detect completion or stalling
12. Persist messages to SQLite on completion

**Key types defined in `runtime-types.ts`:**

`AgentRunContext` — immutable execution state containing conversation, model, settings, provider, signal, project path, tool approvals, standards, and optional sub-agent context.

`AgentFeature` — pluggable unit with optional methods: `isEnabled()`, `getPromptFragments()`, `getTools()`, `filterTools()`, `getLifecycleHooks()`.

`AgentLifecycleHook` — callbacks for `onRunStart`, `onStreamChunk`, `onToolCallStart`, `onToolCallEnd`, `onRunError`, `onRunComplete`.

**Supporting modules in `agent/`:**

| Module | Responsibility |
|---|---|
| `stream-part-collector.ts` | Stateful chunk parser; accumulates text, tool calls, reasoning |
| `stream-processor.ts` | Stream iteration with timeout and retry |
| `prompt-builder.ts` | Assembles system prompt from fragments |
| `prompt-pipeline.ts` | Ordered prompt fragment composition |
| `system-prompt.ts` | Base system prompt content |
| `standards-prompt.ts` | Standards/skills injection into prompt |
| `standards-context.ts` | Load agents and skills from project |
| `feature-registry.ts` | Feature composition for a run |
| `lifecycle-hooks.ts` | Hook dispatch to all registered hooks |
| `message-mapper.ts` | Conversation messages to chat format |
| `agent-message-builder.ts` | Build messages for the chat call |
| `agent-continuation.ts` | Resume interrupted runs |
| `continuation-normalizer.ts` | Normalize continuation messages |
| `quality-config.ts` | Quality preset resolution (temperature, tokens) |
| `error-classifier.ts` | Agent-specific error classification |
| `phase-tracker.ts` | Track agent execution phases |
| `title-generator.ts` | LLM-generated conversation titles |
| `retry.ts` | Retry logic for stalled streams |
| `waggle-coordinator.ts` | Multi-agent turn coordination |
| `waggle-file-cache.ts` | Shared file state across waggle agents |
| `consensus-detector.ts` | Detect agreement between waggle agents |
| `file-conflict-tracker.ts` | Track file conflicts in waggle mode |
| `conversation-cleanup.ts` | Post-run conversation maintenance |
| `tool-context-attachments.ts` | Attachment extraction for tool context |

### Provider Registry (`providers/`)

Singleton `providerRegistry` in `registry.ts` with in-memory maps from model IDs to provider definitions.

**6 provider adapters:**

| File | Provider |
|---|---|
| `anthropic.ts` | Anthropic (Claude) |
| `openai.ts` | OpenAI (GPT, o-series) |
| `gemini.ts` | Google Gemini |
| `grok.ts` | xAI Grok |
| `openrouter.ts` | OpenRouter (aggregator) |
| `ollama.ts` | Ollama (local) |

`index.ts` calls `registerAllProviders()` at startup, lazy-loading each provider and catching individual failures so one broken provider does not crash the app.

`provider-definition.ts` defines the `ProviderDefinition` interface: `id`, `displayName`, `requiresApiKey`, `supportsBaseUrl`, `supportsSubscription`, `models`, `testModel`, `supportsAttachment()`, `createAdapter()`, and optional `fetchModels()` and `resolveSampling()`.

`provider-resolver.ts` validates that a provider is registered and enabled, checks API key configuration, refreshes subscription tokens if needed, and resolves quality config with optional per-project overrides.

`model-classification.ts` provides model capability detection (reasoning models, vision support, etc.).

### Tool System (`tools/`)

`define-tool.ts` is the tool factory. `defineOpenWaggleTool()` creates tools with:
- Effect Schema input validation
- A `[OPEN_WAGGLE_TOOL_BINDER]` symbol property for context binding
- Typed execute functions receiving `(args, context: ToolContext)`

`ToolContext` contains: `conversationId`, `projectPath`, `attachments`, `signal`, `dynamicSkills`, `dynamicAgents`, `waggle`, and optional `subAgentContext`.

`bindToolContextToTools()` attaches per-run `ToolContext` to each tool before execution, instruments output (truncation, error handling), and applies context injection.

**21 built-in tools in `tools/tools/`:**

**Approval-required (4):**
- `writeFile` — Create or overwrite files
- `editFile` — Edit existing files
- `runCommand` — Execute shell commands
- `webFetch` — HTTP requests

**Safe (17):**
- `readFile`, `glob`, `listFiles` — Read-only filesystem operations
- `loadAgents`, `loadSkill` — Dynamic agent/skill loading
- `askUser`, `proposePlan` — User interaction
- `orchestrate`, `spawnAgent` — Multi-agent coordination
- `taskCreate`, `taskUpdate`, `taskList`, `taskGet` — Task management
- `teamCreate`, `teamDelete` — Team management
- `sendMessage` — Inter-agent messaging

`registry.ts` collects tools from `AgentFeature.getTools()` methods and applies feature-level filters sequentially. Validates unique tool names.

### MCP Integration (`mcp/`)

| Module | Responsibility |
|---|---|
| `mcp-manager.ts` | Lifecycle management for multiple MCP servers |
| `mcp-client.ts` | Individual server connection with retry/reconnect |
| `mcp-tool-bridge.ts` | Bridge MCP tools to TanStack AI ServerTool format |
| `mcp-feature.ts` | AgentFeature implementation for MCP tools |
| `index.ts` | Exports |

Supports stdio (child process), SSE, and HTTP transports. MCP tools are injected into the agent's tool set at runtime via the feature system.

### Orchestration Engine (`orchestration/`)

Task-graph execution with dependency tracking and parallel scheduling.

| Module | Responsibility |
|---|---|
| `engine/` | Core engine: task graph, scheduler, execution |
| `service/` | Model runner, planner, prompt builder |
| `run-repository.ts` | Persist runs and tasks to SQLite |
| `run-repository-mapper.ts` | Map between DB rows and domain types |
| `run-record-transforms.ts` | Transform run records for API responses |
| `active-runs.ts` | Track in-progress runs |
| `executor-tools.ts` | Tools available during orchestrated execution |
| `project-context.ts` | Project context for orchestrated runs |

Uses event sourcing: events are persisted as an immutable log in `orchestration_events`. Read models (`orchestration_runs`, `orchestration_run_tasks`) are derived from events.

### Sub-Agent System (`sub-agents/`)

| Module | Responsibility |
|---|---|
| `sub-agent-runner.ts` | Execute sub-agent runs |
| `sub-agent-registry.ts` | Track active sub-agents |
| `sub-agent-bridge.ts` | Bridge between parent and sub-agent |
| `message-bus.ts` | Async message delivery between agents |
| `task-board.ts` | Per-agent task tracking |
| `team-manager.ts` | Multi-agent team coordination |
| `worktree-manager.ts` | Isolated git worktrees per sub-agent |
| `background-executor.ts` | Run agents in background with concurrency limits |
| `agent-type-registry.ts` | Registry of agent type definitions |
| `facade.ts` | Simplified API for sub-agent operations |

Nesting depth is bounded. Permission escalation is prevented (sub-agents cannot grant themselves more permissions than their parent).

### Authentication (`auth/`)

| Module | Responsibility |
|---|---|
| `flows/` | Provider-specific OAuth flow implementations |
| `token-manager.ts` | Token storage, refresh, and lifecycle |
| `oauth-callback-server.ts` | Local HTTP server for OAuth redirects |
| `pkce.ts` | PKCE challenge generation |

Supports OAuth for Anthropic, OpenAI, and OpenRouter. Tokens encrypted via Electron `safeStorage` and persisted in SQLite `auth_tokens` table.

### Persistence (`services/database-service.ts`, `store/`)

SQLite database at `{userData}/openwaggle.db` via `@effect/sql-sqlite-node`.

**11 application tables:**

| Table | Purpose |
|---|---|
| `settings_store` | Key-value JSON settings |
| `auth_tokens` | Encrypted OAuth tokens per provider |
| `conversations` | Conversation records with metadata |
| `conversation_messages` | Messages within conversations |
| `conversation_message_parts` | Content parts within messages |
| `orchestration_events` | Immutable event log for orchestration |
| `orchestration_runs` | Read model for run state |
| `orchestration_run_tasks` | Read model for task state |
| `team_presets` | Team configuration presets |
| `provider_session_runtime` | Provider session state |
| `team_runtime_state` | Sub-agent team state |

Plus `_migrations` system table.

**Data access layers in `store/`:**

| Module | Responsibility |
|---|---|
| `conversations.ts` | Load/save conversations with nested messages and parts |
| `settings.ts` | Get/update settings with encryption for sensitive fields |
| `teams.ts` | Team preset persistence |
| `encryption.ts` | AES encryption via Electron `safeStorage` |
| `conversation-lock.ts` | Mutex for concurrent conversation writes |

### Security (`security/electron-security.ts`)

Asserts secure `webPreferences` at BrowserWindow creation:
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`

CSP enforced in two layers: main process response headers via `session.webRequest.onHeadersReceived`, and renderer meta tag. CSP baseline: `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `connect-src 'self' ws://localhost:* http://localhost:* https://localhost:* wss://localhost:*`.

Navigation restricted to renderer origin. External URLs open in system browser. Media permissions limited to microphone (for voice features).

### Configuration (`config/`)

| Module | Responsibility |
|---|---|
| `project-config.ts` | Parse `.openwaggle/config.toml` and `config.local.toml` |
| `project-config-trust.ts` | Tool approval pattern matching and trust derivation |

Project config provides: quality overrides, tool approval patterns (whitelist for runCommand, webFetch), and project preferences (default model, quality preset).

### Environment and Logging

`env.ts` — Effect Schema-validated environment variables: `ELECTRON_RENDERER_URL`, `OPENWAGGLE_USER_DATA_DIR`, `OPENWAGGLE_LOG_LEVEL`, `OPENWAGGLE_ENABLE_APPROVAL_TRACE`. Provides `safeChildEnv()` (minimal env for spawned processes, strips secrets) and `safeGhCliEnv()` (strips GITHUB_TOKEN for keyring auth).

`logger.ts` — Buffered async file writer with timestamped log files, 3-day retention, level filtering (debug/info/warn/error), namespace support, and safe serialization of unserializable data.

---

## Preload Layer

`src/preload/api.ts` defines 88 methods on the `api` object, organized by domain.

Three generic IPC helpers:

| Helper | Pattern | Usage |
|---|---|---|
| `invoke<C>(channel)` | Request-response | Returns `(...args) => Promise<return>` |
| `send<C>(channel)` | Fire-and-forget | Returns `(...args) => void` |
| `on<C>(channel)` | Event subscription | Returns `(callback) => unsubscribe` |

The `api` object is exposed to the renderer as `window.api` via `contextBridge.exposeInMainWorld('api', api)` in `index.ts`.

---

## Shared Type System

### IPC Channel Maps (`types/ipc.ts`)

Single source of truth for all cross-process communication.

| Map | Count | Pattern |
|---|---|---|
| `IpcInvokeChannelMap` | 79 channels | `{ args: [...], return: T }` |
| `IpcSendChannelMap` | 5 channels | `{ args: [...] }` |
| `IpcEventChannelMap` | 18 channels | `{ payload: T }` |

`OpenWaggleApi` interface derives typed method signatures from these maps. Preload implements it; renderer consumes it.

### Branded Types (`types/brand.ts`)

13 branded types using Effect's `Brand.nominal()`:

| Type | Base |
|---|---|
| `ConversationId` | `string` |
| `MessageId` | `string` |
| `ToolCallId` | `string` |
| `OrchestrationRunId` | `string` |
| `OrchestrationTaskId` | `string` |
| `TeamConfigId` | `string` |
| `McpServerId` | `string` |
| `SupportedModelId` | `string` |
| `SubAgentId` | `string` |
| `TaskId` | `string` |
| `AgentMessageId` | `string` |
| `TeamId` | `string` |
| `SkipApprovalToken` | `symbol` |

Each has a corresponding constructor function (e.g., `ConversationId(rawString)`). `SkipApprovalToken` uses `createSkipApprovalToken()` to gate approval bypass to the waggle coordinator.

### Domain Types

| File | Key Types |
|---|---|
| `agent.ts` | `MessageRole`, `MessagePart` (discriminated union: text, attachment, tool-call, tool-result, reasoning), `Message`, `AgentSendPayload`, `PreparedAttachment`, `HydratedAttachment` |
| `conversation.ts` | `Conversation`, `ConversationSummary` |
| `settings.ts` | `Provider` (6 literals), `ExecutionMode` (`'default-permissions' \| 'full-access'`), `QualityPreset` (`'low' \| 'medium' \| 'high'`), `ProviderConfig`, `Settings` |
| `llm.ts` | `SupportedModelId`, `ModelDisplayInfo`, `ProviderInfo`, `generateDisplayName()` |
| `tools.ts` | `ToolCallRequest`, `ToolCallResult`, `ToolCallApprovalState` |
| `git.ts` | `GitFileStatus`, `GitChangedFile`, `GitStatusSummary`, `GitCommitPayload`, `GitBranchInfo` |
| `orchestration.ts` | `OrchestrationRunStatus`, `OrchestrationTaskStatus`, `OrchestrationRunRecord`, `OrchestrationEventPayload` |
| `waggle.ts` | `WaggleConfig`, `WaggleAgentSlot`, `WaggleTeamPreset`, `WaggleStreamMetadata`, `WaggleTurnEvent` |
| `mcp.ts` | `McpServerConfig`, `McpServerStatus` |
| `auth.ts` | `OAuthFlowStatus` (discriminated union), `SubscriptionAccountInfo` |
| `errors.ts` | `AgentErrorCode` (11 values), `AgentErrorInfo`, `classifyErrorMessage()` |
| `tool-approval.ts` | `ToolApprovalConfig` |
| `sub-agent.ts` | `SubAgentContext`, `AgentToolFilter` |

### Utilities

| Module | Purpose |
|---|---|
| `utils/decision.ts` | Pattern-matching library for exhaustive discriminated union handling |
| `utils/validation.ts` | Type-safe `includes()`, `isRecord()`, `isValidBaseUrl()` |
| `utils/parse-json.ts` | JSON parsing with Effect Schema validation |
| `utils/node-error.ts` | Node.js error guards (`isEnoent`, `formatErrorMessage`) |
| `utils/tool-trust-patterns.ts` | Derive approval patterns from tool arguments |
| `utils/skill-references.ts` | Extract skill IDs from text (`/skillId`, `$skillId`) |
| `schema.ts` | Effect Schema wrappers: `decodeUnknownOrThrow()`, `safeDecodeUnknown()` |
| `constants/constants.ts` | Numeric constants (byte sizes, time units, HTTP codes) |

---

## Renderer Architecture

### State Management

13 Zustand stores:

| Store | File | Responsibility |
|---|---|---|
| `useChatStore` | `chat-store.ts` | Conversation list, active conversation, CRUD |
| `useComposerStore` | `composer-store.ts` | Input text, prompt history, attachments, menu state, Lexical editor ref |
| `useComposerActionStore` | `composer-action-store.ts` | Action dialogs (branch create/rename/delete, upstream, full access) |
| `useUIStore` | `ui-store.ts` | Sidebar, panels, toasts, command palette, settings tab, feedback modal, active view |
| `usePreferencesStore` | `preferences-store.ts` | Global settings, default model, quality preset, project path, recent projects |
| `useProviderStore` | `provider-store.ts` | Provider models, API key state, test results, dynamic model fetch |
| `useAuthStore` | `auth-store.ts` | OAuth flow status per provider, account info |
| `useGitStore` | `git-store.ts` | Branch list, git status, commit state |
| `useMessageQueueStore` | `message-queue-store.ts` | Per-conversation pending message queues |
| `useWaggleStore` | `waggle-store.ts` | Multi-agent collaboration state (turns, agents, consensus) |
| `useThreadStatusStore` | `thread-status-store.ts` | Per-conversation run status, read/unread tracking |
| `useBackgroundRunStore` | `background-run-store.ts` | Active background run IDs |
| `useReviewStore` | `review-store.ts` | Code review comments and active location |

All stores use granular selectors (`useChatStore(s => s.field)`). No store is called without a selector. Store actions call `window.api.*` methods for main process communication.

### Navigation

No router. View-based navigation via `useUIStore`:
- Active view: `'chat' | 'skills' | 'mcps'`
- Settings overlay: separate mode with tabbed sections
- Conversation switching via `useChatStore.setActiveConversation()`

### Component Architecture

**App shell** (`components/app/`):
- `WorkspaceShell` — Primary layout: sidebar + header + content area
- `WorkspaceMainContent` — View switcher (chat, skills, MCPs)
- `WorkspaceTerminal` — Terminal output panel
- `AppSettingsView` — Full-screen settings overlay
- `ToastOverlay` — Toast notification container

**Chat system** (`components/chat/`):
- `ChatPanel` — Orchestrator component, owns the chat lifecycle
- `ChatTranscript` — Scrollable message history
- `ChatComposerStack` — Input area with approval/ask-user/waggle banners
- `ChatRowRenderer` — Dispatches row types to renderers (message, segment, phase, error, summary)
- `AssistantMessageBubble` — Renders AI response parts (text, tool calls, reasoning)
- `UserMessageBubble` — Renders user messages with attachment display
- `StreamingText` — ReactMarkdown + Shiki syntax highlighting, always active (no plain-text fallback)
- `ToolCallBlock` / `ToolCallRouter` — Renders tool execution with type-specific display
- `ApprovalBanner` — Approval UI for gated tool calls
- `AskUserBlock` — Agent question UI
- `PlanModeBanner` — Plan mode indicator
- `WelcomeScreen` — Empty state with project selection
- `ChatErrorDisplay` — Classified error display with retry/settings buttons

**Composer** (`components/composer/`):
- `Composer` — Container component, keyboard submission, file attach
- `LexicalComposerEditor` — Lexical rich text editor setup

  8 Lexical plugins:
  - `KeyboardPlugin` — Enter to submit, Shift+Enter for newline, arrow keys for history, `/` for command palette
  - `SyncPlugin` — Sync editor text content to Zustand store
  - `AutoResizePlugin` — Dynamic textarea height
  - `MentionTypeaheadPlugin` — @mention typeahead dropdown
  - `URLDetectPlugin` — Auto-detect and linkify URLs
  - `PastePlugin` — Handle paste with conversion
  - `EditorRefPlugin` — Expose Lexical editor ref to store
  - `HistoryPlugin` — Undo/redo (from Lexical)

  4 custom mention node types:
  - `FileMentionNode` — File path mentions
  - `SkillMentionNode` — Skill references
  - `SymbolMentionNode` — Code symbol mentions
  - `URLMentionNode` — URL mentions

- `ComposerToolbar` — Action buttons (quality, execution, branch, voice, attach)
- `ComposerStatusBar` — Model, preset, project display
- `ComposerAlerts` — Attachment and permission errors
- `ActionDialog` — Modal for branch/upstream operations
- `BranchPicker` — Branch selection dropdown
- `QueuedMessages` — Pending message display during streaming
- `VoiceRecorder` — Voice input UI

**Settings** (`components/settings/`):
- `SettingsPage` — Shell with tab navigation and content area
- Sections: General, Connections, Waggle, Archived
- Connections section contains per-provider rows with key editor, base URL, model lists, subscription auth

**Layout** (`components/layout/`):
- `Sidebar` — Conversation list, project picker, sort/filter, new conversation button
- `Header` — Title bar, breadcrumbs, controls

**Command Palette** (`components/command-palette/`):
- `CommandPalette` — Fuzzy search UI triggered by `/` in composer
- Sections: slash skills, waggle presets, commands
- Keyboard navigation (up/down/enter/escape)

**Other:**
- `components/waggle/` — Collaboration status display, turn dividers
- `components/skills/` — Skills browser panel
- `components/mcp/` — MCP servers browser panel
- `components/diff-panel/` — Git diff display
- `components/feedback/` — Bug report modal
- `components/shared/` — Error boundaries, popover, context menu, spinner, model selector
- `components/devtools/` — TanStack AI debugging panel

### IPC Connection Adapter

`lib/ipc-connection-adapter.ts` implements TanStack AI's `ConnectionAdapter` over Electron IPC.

It wraps `api.sendMessage()` (or `api.sendWaggleMessage()`) as an async iterable of `StreamChunk`, allowing TanStack AI's `useChat()` hook to manage message state over the Electron process boundary. Error classification uses shared `classifyErrorMessage()` and stores structured `AgentErrorInfo` in a side map for display.

### TanStack Integration

**TanStack AI React:** `useChat()` hook from `@tanstack/ai-react` with the custom IPC connection adapter. Manages `UIMessage[]` state with incremental part building from stream chunks.

**TanStack React Query:** `rendererQueryClient` singleton (no retries, 30s staleTime, networkMode `'always'`). Queries for: skills/standards, skill previews, team presets, archived conversations, MCP server list.

### Styling

Tailwind v4 with CSS custom properties in `styles/globals.css`. Dark theme (background `#0d0f12`). Custom properties for surfaces, borders, text, semantic colors, diff colors, and typography. `cn()` utility for conditional class composition. React Compiler handles memoization (no manual `React.memo`, `useMemo`, or `useCallback` for render optimization).

---

## Data Flow

### Agent Execution (primary path)

```
User types in Composer
  -> Zustand captures input, attachments, quality preset
  -> onSend() creates conversation (if draft) via IPC invoke
  -> TanStack AI useChat() calls ConnectionAdapter.connect()
  -> Adapter invokes api.sendMessage(conversationId, payload)
  -> Preload forwards to 'agent:send-message' IPC channel
  -> Main: agent-handler starts runAgentEffect()
  -> Agent loop resolves provider, builds features/tools/prompt
  -> Calls LLM via TanStack AI chat() -> AsyncIterable<StreamChunk>
  -> StreamPartCollector processes each chunk:
      Text deltas -> emitted as stream events over IPC
      Tool calls -> approval check -> execute -> result emitted
  -> Renderer receives chunks via api.onStreamChunk()
  -> TanStack AI builds UIMessage incrementally
  -> React renders: ChatRowRenderer -> AssistantMessageBubble -> StreamingText
  -> On completion: messages persisted to SQLite, run-completed emitted
```

### Conversation Persistence

```
Messages created during agent loop
  -> Saved to SQLite: conversations -> conversation_messages -> conversation_message_parts
  -> On conversation switch: renderer calls api.getConversation(id)
  -> Main loads from DB, returns Conversation with nested messages/parts
  -> Renderer hydrates via conversationToUIMessages()
  -> useHydratedConversationMessages() merges persisted + any live streaming
```

### Tool Approval

```
LLM emits TOOL_CALL for approval-required tool
  -> Agent loop checks tool's needsApproval flag + project trust patterns
  -> If not auto-approved: emits 'approval-requested' custom chunk via IPC
  -> Renderer shows ApprovalBanner
  -> User approves or denies
  -> api.respondToolApproval(id, approved) sent to main
  -> Main resumes tool execution or halts
  -> Result flows into next agent iteration
```

### Settings Update

```
User changes setting in SettingsPage
  -> Zustand store action calls api.updateSettings(partial)
  -> Preload forwards to 'settings:update' invoke channel
  -> Main merges into SQLite settings_store
  -> Provider store refreshes models if provider config changed
  -> Agent loop reads current settings at next run start
```

### Multi-Agent Collaboration (Waggle)

```
User starts waggle with team config
  -> api.sendWaggleMessage(conversationId, payload, config)
  -> Main: waggle-coordinator manages turn sequence
  -> Each turn: select agent, run agent loop with agent's model/role
  -> Stream chunks include WaggleStreamMetadata (agent index, label, color, turn)
  -> Renderer: useWaggleStore tracks turns, active agent, consensus
  -> Turn events (turn-start, turn-end, consensus, conflicts) via waggle:turn-event
  -> On completion: synthesis turn combines agent outputs
```

### Orchestration

```
Agent calls orchestrate tool
  -> OrchestrationEngine builds task graph with dependencies
  -> Scheduler executes ready tasks in parallel (up to concurrency limit)
  -> Each task runs as a sub-invocation of the agent loop
  -> Events persisted to orchestration_events (immutable log)
  -> Read models (orchestration_runs, orchestration_run_tasks) updated
  -> Orchestration events streamed to renderer via orchestration:event channel
  -> Results synthesized by LLM and returned to parent conversation
```

---

## IPC Communication Patterns

Three modes defined by the channel maps:

| Mode | Direction | Channels | Mechanism |
|---|---|---|---|
| **Invoke** | Renderer -> Main -> Renderer | 79 | `ipcRenderer.invoke()` / `ipcMain.handle()`. Request-response. Returns `Promise<T>`. |
| **Send** | Renderer -> Main | 5 | `ipcRenderer.send()` / `ipcMain.on()`. Fire-and-forget. No response. |
| **Event** | Main -> Renderer | 18 | `webContents.send()` / `ipcRenderer.on()`. Subscription with unsubscribe function. |

All event subscriptions return an unsubscribe function (`() => ipcRenderer.removeListener(channel, handler)`) to prevent memory leaks.

---

## External Integrations

### LLM Providers

6 providers accessed via TanStack AI adapter libraries:
- Anthropic (`@tanstack/ai-anthropic`)
- OpenAI (`@tanstack/ai-openai`)
- Gemini (`@tanstack/ai-gemini`)
- Grok (`@tanstack/ai-grok`)
- OpenRouter (`@tanstack/ai-openrouter`)
- Ollama (`@tanstack/ai-ollama`)

Communication via HTTPS API calls. Authentication via API keys or OAuth tokens. Dynamic model fetching supported for OpenRouter and Ollama.

### MCP Servers

External process-based tool servers conforming to the Model Context Protocol. Three transports: stdio (child process), SSE (server-sent events), HTTP. Managed by `McpManager` with per-server lifecycle, retry, and reconnection. Tools bridged into the agent's tool set via the feature system.

### Local Filesystem

Agent tools read/write files, execute shell commands, and manage git operations on the local machine. `safeChildEnv()` strips secrets from the environment before spawning child processes. Atomic file writes use tmp-then-rename pattern.

### SQLite

`@effect/sql-sqlite-node` wrapping `better-sqlite3`. Migrations applied at startup. Encryption of sensitive fields via `safeStorage`. Conversation lock mutex prevents concurrent writes to the same conversation.

### OAuth

PKCE flows for Anthropic, OpenAI, OpenRouter. Local callback server receives authorization codes. Tokens encrypted and persisted in `auth_tokens` table. Refresh lifecycle managed by `token-manager.ts`.

### GitHub CLI

Used for feedback submission (`gh issue create`). Environment sanitized via `safeGhCliEnv()` to use keyring auth instead of token-based auth.

### System APIs

| API | Usage |
|---|---|
| Electron `safeStorage` | AES encryption for API keys and tokens |
| `node-pty` | Terminal emulation for embedded terminal |
| `@xenova/transformers` | Local Whisper model for voice transcription |
| Electron auto-updater | Application update checks and installation (GitHub releases) |
| System browser | Opening external URLs |
| Microphone | Voice input recording |

---

## Build System

### Targets

electron-vite builds three targets from `electron.vite.config.ts`:

| Target | Output | Key Config |
|---|---|---|
| Main | CJS bundle | Externalizes native deps, bundles ESM-only packages (Effect, TanStack AI adapters, MCP SDK) |
| Preload | CJS bundle | Lightweight, TypeScript resolution only |
| Renderer | Vite SPA | React, Babel (React Compiler), Tailwind v4, SVGR, TanStack devtools |

### TypeScript

| Config | Scope |
|---|---|
| `tsconfig.node.json` | Main + Preload + Shared |
| `tsconfig.web.json` | Renderer + Shared |

Both use strict mode, bundler module resolution, and ES2022 target.

### Path Aliases

| Alias | Resolution | Available In |
|---|---|---|
| `@shared/*` | `src/shared/*` | All targets |
| `@/*` | `src/renderer/src/*` | Renderer only |

### Testing

| Config | Pattern | Environment |
|---|---|---|
| `vitest.unit.config.ts` | `*.unit.test.ts` | node |
| `vitest.integration.config.ts` | `*.integration.test.ts` | node |
| `vitest.component.config.ts` | `*.component.test.tsx` | jsdom |
| `playwright.config.ts` | `e2e/` | Electron |

### Packaging

electron-builder produces: macOS DMG (universal), Windows NSIS (x64), Linux AppImage (x64). Published to GitHub releases.

---

## Source Map

| Concern | Primary File(s) |
|---|---|
| App entry | `src/main/index.ts` |
| Effect runtime | `src/main/runtime.ts` |
| IPC type contract | `src/shared/types/ipc.ts` |
| IPC handler bridge | `src/main/ipc/typed-ipc.ts` |
| Agent loop | `src/main/agent/agent-loop.ts` |
| Agent types | `src/main/agent/runtime-types.ts` |
| Stream processing | `src/main/agent/stream-part-collector.ts`, `src/main/agent/stream-processor.ts` |
| Provider registry | `src/main/providers/registry.ts`, `src/main/providers/provider-definition.ts` |
| Tool factory | `src/main/tools/define-tool.ts` |
| Tool list | `src/main/tools/built-in-tools.ts` |
| Database | `src/main/services/database-service.ts` |
| Security | `src/main/security/electron-security.ts` |
| Preload bridge | `src/preload/api.ts` |
| Branded types | `src/shared/types/brand.ts` |
| Schema validation | `src/shared/schema.ts` |
| Error classification | `src/shared/types/errors.ts` |
| Renderer entry | `src/renderer/src/main.tsx` |
| Chat orchestration | `src/renderer/src/components/chat/ChatPanel.tsx` |
| IPC adapter | `src/renderer/src/lib/ipc-connection-adapter.ts` |
| Composer | `src/renderer/src/components/composer/Composer.tsx` |
| State stores | `src/renderer/src/stores/` |
