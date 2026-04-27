---
name: project-learnings
description: Technical learnings log for OpenWaggle. Stores warnings, pattern preferences, and historical engineering learnings; workflow policy lives in AGENTS.md and CLAUDE.md.
owner: openwaggle-core
last_updated: 2026-04-25
---

# LEARNINGS.md

This document stores project-specific technical learnings only.

## 1) Active Warnings

- None currently.

## 2) Pattern Preferences

- Add only durable technical guidance that improves implementation quality.
- Do not add routine project-management notes unless they materially affect implementation behavior.

## 3) Recent Learnings

### Release & Update Versioning

- Electron update safety needs explicit release-channel metadata and update-track policy in addition to semver prerelease strings. A version like `1.0.0-alpha.3` identifies the installed build kind, but once users can opt into Alpha/Beta from Settings, future update eligibility must be driven by separate selected update-track state. [SKILL: release]
- OpenWaggle release intent should be modeled as committed change metadata consumed into changelog/GitHub Release notes, while Alpha/Beta/RC remain release-train state owned by the release workflow rather than repeated on every change entry. [SKILL: release]

### Pi Runtime & Session Projection

- Pi SDK is an adapter detail, not an application contract. Application, IPC, shared, renderer, and domain layers should speak OpenWaggle-owned types such as `AgentKernelService`, `AgentTransportEvent`, `SessionId`, `SessionNodeId`, and `SessionBranchId`; Pi SDK imports belong under `src/main/adapters/pi/` only. [SKILL?]
- Pi JSONL sessions are internal runtime state. SQLite session projection (`sessions`, `session_nodes`, `session_branches`, branch state, tree UI state, and run linkage) is the canonical product read model for renderer navigation, branching, and persistence.
- During the clean-cut migration, projected SQLite node ids can temporarily outlive or diverge from the Pi JSONL entries available to `session.navigateTree(...)`. Treat missing-entry navigation as cancelled/stale navigation instead of throwing through IPC, and avoid calling Pi navigation for draft branch selection before the next send materializes the branch. [SKILL?]
- Do not preserve legacy flat-conversation bootstrapping as active behavior during the Pi migration. Pre-user/dev data can be discarded; retaining compatibility tables or startup backfills keeps flat-thread assumptions alive.
- Pi owns the initial runtime tool surface. Standard OpenWaggle sends should not pass an OpenWaggle-owned `tools` or `customTools` allowlist; OpenWaggle renders Pi-emitted native tool events and should add future capabilities only as explicit Pi-native extensions behind ports. [SKILL?]
- Renderer streaming should reduce `AgentTransportEvent` into OpenWaggle-owned `UIMessage` state. The renderer must not depend on vendor stream shapes, hidden coordination markers, or artificial turn-boundary tool calls.
- Waggle must emit explicit per-turn assistant messages and metadata. A single assistant message split by compatibility markers is not a Pi-native transcript model.
- Waggle coordination prompts should go through Pi custom messages with hidden display metadata, while the visible user request remains a separate projected user node. Do not send internal turn instructions through the normal user-prompt path or they will persist as transcript content.

### Provider & Resource Boundaries

- Provider/model/auth metadata should be Pi-derived through adapter ports, not maintained as an OpenWaggle provider registry. Renderer and IPC DTOs can stay OpenWaggle-owned, but their contents must come from Pi `AuthStorage`, `ModelRegistry`, and cwd-bound session services.
- Pi tool-call events can provide canonical input/result data at the adapter boundary. Prefer emitting authoritative OpenWaggle transport events once the tool state is known instead of renderer-side repair layers.
- OpenWaggle bridges `.openwaggle/skills` into Pi by passing it as an additional Pi `DefaultResourceLoader` skill path. The adapter also filters `.openwaggle/skills` and root `.agents/skills` with OpenWaggle catalog toggles while leaving `.pi/skills` and Pi's native discovery unchanged. [SKILL?]
- Pi `ModelRegistry.registerProvider()` requires enough provider metadata to be runtime-valid even in tests: custom providers with models need `baseUrl` and either `apiKey` or `oauth`. [SKILL?]
- Pi's extension loader uses `import.meta.resolve()` on its Node alias path. Electron's CJS main-process bundle can rewrite that incorrectly, so OpenWaggle must force Pi's bundled virtual-module loader branch and fail loudly if the loader shape changes. [SKILL?]
- Pi `SessionManager.create()` allocates a session id and file path before a run, but the JSONL file is not written until Pi flushes entries. If OpenWaggle opens that missing path later, Pi creates a different id; preserve the pre-created id by creating a fresh `SessionManager` and calling `newSession({ id })` before the first prompt. [SKILL?]
- Pi TUI builds runtime services with `createAgentSessionServices()` before model resolution so extension/provider registrations are applied to the project-scoped `ModelRegistry`. OpenWaggle should use that same service path for project runs and project-scoped provider catalogs instead of resolving models from a bare global registry. [SKILL?]
- Pi `ModelRegistry.getAvailable()` means a provider has configured auth through auth.json, environment, OAuth, or custom config. It does not guarantee account-level entitlement for every listed model; model/account rejection handling must remain runtime diagnostic behavior, not a hardcoded provider/model suppression list. [SKILL?]
- Pi exposes OAuth-capable providers through `AuthStorage.getOAuthProviders()`, but does not expose an equivalent API-key-capable provider list. Until the SDK adds one, keep any API-key capability mirror confined to the Pi adapter and treat provider-level availability, API-key configuration, and OAuth connection as separate state. [SKILL?]
- OpenWaggle project config is `.openwaggle/settings.json`, not TOML. Top-level keys are OpenWaggle-owned, and Pi settings live under `pi`; the Pi adapter bridges that nested object into Pi with `SettingsManager.fromStorage(...)` while still allowing Pi's native `.pi/settings.json` input at lower precedence. [SKILL?]
- Current Pi SDK types tool result payloads as JSON values, not strings. Preserve structured tool results in OpenWaggle persistence/UI state and serialize to text only when rebuilding Pi history entries that require text content. [SKILL?]
- Thinking levels are Pi-native run options, not OpenWaggle quality presets. Store/pass Pi levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`) directly and do not reintroduce project-level sampling/quality tier config. [SKILL?]
- Pi `createAgentSession({ thinkingLevel })` only forces `off` for non-reasoning models; it does not clamp unsupported `xhigh` to model-specific availability the way `AgentSession.setThinkingLevel()` does. Clamp requested levels in the Pi adapter or route changes through `setThinkingLevel()` before prompting so OpenWaggle state and Pi session entries do not record unsupported `xhigh`. [SKILL?]
- API-key provider probing currently uses the process cwd when constructing Pi runtime services. Project-scoped custom provider validation requires passing the selected project path through the provider-test flow. [SKILL?]
- OpenWaggle's integrated terminal environment filtering does not constrain Pi's native `bash` tool environment. Any product guarantee about Pi tool shell env must be implemented in the Pi adapter, not inferred from terminal settings. [SKILL?]
- Pi compaction rewrites the active working context as `compaction summary → kept messages from firstKeptEntryId → later messages`; OpenWaggle transcript/workspace projections must mirror that ordering instead of walking the raw parent path, or summarized history remains visible and the summary appears in the wrong place. [SKILL?]
- Pi emits `compaction_end` before OpenWaggle persists the SQLite session projection. For manual compaction IPC, delay the successful end event until after `compactAgentSession` persists the projected snapshot so renderer queue flushing cannot start the next send against stale product state. [SKILL?]

### Electron & Renderer Patterns

- React Compiler handles render memoization, but external hook/effect identities still need stable references when those identities are semantically required.
- Renderer state selectors must remain granular and stable; avoid selectors that allocate new objects or arrays on every render.
- Background-run reconnection hooks must guard by conversation id and persisted snapshot key before starting async rehydration. Re-rendering from a fresh-but-equivalent conversation object can otherwise create an infinite reconnect/render loop that appears as a Vitest worker OOM. [SKILL?]
- First-message sends can cross a route remount before the persisted SQLite user node is reflected in the renderer conversation snapshot. Keep optimistic user turns in renderer-owned state keyed by conversation id, merge them into hydration/background reconnect snapshots, and mark a remounted run as background streaming on `agent_start` so subsequent stream events are not dropped. [SKILL?]
- Session-native transcript rendering must read from `SessionWorkspace.transcriptPath` for the active route/branch/node selection, not from the flat conversation tail. Preserve live tails only when the selected workspace is already at the active branch head; draft/earlier-node views should hide downstream main-branch continuation. [SKILL?]
- Electron QA for renderer, preload, and IPC changes must exercise the real app through CDP after static checks pass.
- Chromium DIPS SQLite startup warnings in dev can be caused by multiple Electron dev instances sharing the same user data profile. Acquire Electron's single-instance lock before normal app lifecycle startup and keep `sessionData` under the configured `userData` directory.
- Playwright Electron E2E can run while a developer OpenWaggle instance is already open only if the test app opts out of the single-instance lock and uses an isolated `OPENWAGGLE_USER_DATA_DIR`; otherwise Electron exits before `firstWindow()` even though the renderer/debug ports briefly appear. [SKILL?]
- Electron Playwright E2E launches the built app from an unpackaged Electron runtime, so `is.dev` can be true even when no Vite dev-server URL exists. Register the production renderer protocol whenever no dev renderer URL is available; do not key protocol registration on packaged/dev mode alone. [SKILL?]
- For T3Code-style right sidebars, keep the layout gap separate from the sidebar content container: animate the gap width and slide/transform a fixed or absolute content panel. Animating the content panel's width as a flex item makes large diff content participate in layout during open/close and can make toggles feel slow. [SKILL?]
- TanStack Router scans files under `src/renderer/src/routes`, including nested test folders, unless filenames match the configured ignore prefix. Route-adjacent test files should be prefixed with `-` (for example `__tests__/-route-search.unit.test.ts`) or they will produce route-tree build warnings. [SKILL?]

## 4) Old Learnings Archive

Historical migration notes were intentionally removed after the Pi-native cleanup because they described deleted runtime surfaces and were causing future agents to re-import the wrong mental model.
