# MEMORY.md

Durable OpenWaggle project memory. Keep this compact and technical. Do not add personal/cross-repo agent preferences here.

## Active Warnings

- The working tree may contain another agent's active refactor. Treat dirty files as intended future shape unless there is clear evidence otherwise.
- Legacy vendor-specific agent configuration has been removed; keep this repository centered on `AGENTS.md` and `.agents/`.
- Legacy agent memory files were removed. Add durable OpenWaggle memory here or to focused skills.
- `docs/agents/` is reserved for the adapted `/setup-matt-pocock-skills` workflow. Do not manually scaffold it during unrelated work.

## Current Architecture Direction

- OpenWaggle is an Electron desktop coding-agent UI on top of Pi.
- Main-process architecture is hexagonal: domain, ports, adapters, application services, IPC, stores.
- Pi SDK imports belong in `src/main/adapters/pi/` only.
- Provider/model/auth metadata must mirror Pi through `AuthStorage`, `ModelRegistry`, project-scoped runtime services, and OpenWaggle-owned ports.
- OpenWaggle must not maintain a parallel `src/main/providers/` registry.

## Pi Runtime Memory

Load `.agents/skills/pi-integration/SKILL.md` for details.

- Pi JSONL sessions are runtime state; SQLite session projection is the product read model for renderer navigation, branching, persistence, active runs, and UI state.
- Pi-native tool events, thinking levels, compaction behavior, session ids, provider/model ids, and auth methods should stay Pi-native through the adapter boundary.
- Missing projected Pi entries during clean-cut projection rebuilds should be treated as stale/cancelled navigation, not thrown through IPC.
- Preserve Pi-created session ids before first prompt by opening the pre-created id correctly instead of allowing a missing JSONL path to create a different id.
- Build runtime services through Pi's project-scoped service path so extensions/providers are registered before model resolution.
- MCP/package extension loading must be scoped to the active project and adapter cwd so package extensions do not read Electron's process cwd or leak server processes.
- OpenWaggle-owned Pi extension packages must be bundled/copied locally and `asarUnpack`ed for packaged apps.

## Electron Runtime Memory

Load `.agents/skills/electron-runtime/SKILL.md` for details.

- Native addons have separate Node and Electron ABI targets. Rebuild with the repo scripts before blaming app code.
- Packaged apps may not inherit a shell PATH. Pi package/resource loading that shells out to npm needs an adapter-controlled npm-compatible PATH.
- `electron-builder` with pnpm can omit transitive runtime modules unless explicit dependencies are present; `ms` is intentionally explicit for `electron-updater`.
- On Apple silicon, performance/package QA should use arm64 outputs, not Rosetta x64 output from a universal build folder.
- Electron Playwright E2E requires isolated user data and single-instance lock opt-out when another OpenWaggle instance is running.
- CDP file upload can produce `File` objects without native paths; native file-path behavior needs preload/unit coverage or real OS selection QA.

## Renderer And Session Memory

- Renderer state that represents chat transcripts or active runs must be keyed by concrete `SessionId`, not only the active route.
- Switching away from a foreground run should demote it to background state, not reject the send promise as an error.
- Active-run UI continuity needs a renderer-owned render snapshot keyed by session id; persisted run metadata alone does not prove visible reasoning/tool rows remain continuous.
- First-message sends must bind to the concrete newly created session before async send begins; do not enqueue by current active session after users can switch projects.
- Session tree/header refreshes for background sessions must not overwrite the active session tree/header.
- Session-native transcript rendering reads from the active `SessionWorkspace.transcriptPath`; preserve live tails only at active branch head.
- TanStack Router uses hash history in Electron QA; navigate to `http://localhost:5173/#/<route>`.
- TanStack Hotkeys same-target callbacks do not stop each other via `event.stopPropagation`; independent overlays need explicit topmost ordering.

## Product And UX Memory

- Pi-native sidebar navigation is Projects-only. Do not add a global projectless Chats section.
- Waggle mode must run inside Pi as extension/runtime behavior, not as an OpenWaggle application loop that calls Pi once per agent turn.
- Waggle and standard mode share session, branch, draft, archive, transcript, active-run, composer, settings, diff, and git semantics unless Pi imposes a narrow technical constraint.
- Composer branch/config changes are branch-scoped; child branches inherit parent config by default.
- Manual compaction mirrors Pi TUI slash-command UX: `/compact` and `/compact <custom instructions>`, not context-meter-triggered compaction.
- Provider auth UI is method-based. Keep provider-level availability separate from API-key configured state and OAuth connected state.
- Compact composer interactions stay in-row unless the maintainer explicitly asks for a larger workflow.

## Tooling Memory

- Package manager: `pnpm`.
- TypeScript-first tooling is preferred; do not add JavaScript configs when `.ts` is practical.
- No TypeScript `baseUrl`; preserve aliases through explicit `paths` entries.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are the target strictness posture, but enabling them in build tsconfigs requires a dedicated source-modeling pass across the active Pi/session refactor.
- Unit, integration, and component tests belong in nearby `__tests__/`; E2E stays under `e2e/`.
- Do not suppress Fallow complexity findings; refactor instead.
- Do not add legacy compatibility for removed pre-Pi surfaces unless explicitly requested.
