# Pi SDK Migration Blueprint

> Historical migration document. This file records target decisions made during the TanStack-to-Pi migration and is not the current product/runtime contract. Current behavior is described in `README.md`, `docs/architecture.md`, `docs/system-architecture.md`, and the user guide.

_Status: draft_
_Date: 2026-04-22_
_Source of truth for decisions: `docs/specs/pi-sdk-migration-discovery.md`_

## 1. Purpose

This document turns the discovery/grill decisions into a target architecture and migration plan for replacing TanStack AI with Pi SDK as the OpenWaggle runtime kernel.

This is a **full migration**, not a compatibility bridge.

## 2. Non-negotiable target state

### Runtime and product split

#### Pi owns
- Agent runtime execution
- Session/tree semantics at runtime
- Model/provider/auth runtime behavior
- Tool runtime behavior
- Compaction runtime behavior and policy
- Extension/resource runtime system
- Waggle runtime mechanics via a Pi-native thick extension

#### OpenWaggle owns
- Electron shell
- Renderer/UI
- Typed IPC protocol
- Canonical SQLite product projection
- Session list / branch tree / transcript UX
- Branch-scoped future mode/config metadata
- Waggle product semantics and presentation
- Settings UX
- Diff / git / composer / surrounding product behavior

### Migration posture
- Reuse existing product behavior wherever it still fits the Pi-native model.
- Only change what must change for Pi-native sessions/trees/branches and Waggle runtime correctness.
- Do not preserve TanStack-specific runtime abstractions.
- Do not preserve flat conversation/thread compatibility layers.

## 3. One-sentence architecture

> Pi becomes the runtime kernel and session/tree authority; OpenWaggle becomes the canonical product projection and UI shell over that Pi-native runtime.

## 4. Target runtime boundary

## 4.0 Hexagonal boundary rule

Pi SDK must enter OpenWaggle only through **main-process adapter boundaries and ports**.

### Required shape
- Define OpenWaggle-owned ports for Pi-backed runtime concerns.
- Implement those ports in adapters that depend on Pi SDK.
- Consume them from application services via `yield*`.
- Keep IPC handlers transport-thin.
- Keep renderer completely unaware of Pi SDK types.

### Consequences
- `application/` MUST NOT import Pi SDK directly.
- `ipc/` MUST NOT import Pi SDK directly.
- shared IPC/domain types MUST remain OpenWaggle-owned and vendor-free.
- Pi must not become a new cross-layer primitive the way TanStack effectively did.

Suggested ports/adapters to introduce:
- `AgentRuntimePort`
- `SessionRuntimePort`
- `WaggleRuntimePort`
- `SessionProjectionPort` or `SessionProjector`


## 4.1 Session authority

### First identity event
- **Pi session creation is the first identity event**.
- OpenWaggle creates its product session row by projecting from the Pi-native session origin.

### Product implications
- On first send, OpenWaggle triggers Pi session creation immediately.
- Once Pi session creation succeeds, OpenWaggle inserts the session into SQLite and the UI.
- If the first run later fails, the session still remains in history because the initial user send already created a real Pi session and corresponding OpenWaggle projection.

## 4.2 Branch authority

- Pi remains the runtime source of truth for tree/node structure.
- OpenWaggle stores a full projection of that tree in SQLite.
- OpenWaggle owns branch-scoped future mode/config metadata because that is product UI state, not Pi runtime state.

### Branch-owned product metadata
Per branch/path, OpenWaggle should own metadata like:
- future mode: `standard | waggle`
- waggle config reference or embedded snapshot
- branch title
- last selected/active state
- tree expansion state
- local UI metadata

## 4.3 Active run boundary

### Standard run
- OpenWaggle invokes a Pi session prompt/queue operation.
- Pi emits runtime events.
- OpenWaggle translates those events into its own typed IPC/runtime projection stream.
- SQLite projector updates product read models.

### Waggle run
- OpenWaggle decides that the current branch future mode is Waggle.
- OpenWaggle invokes a **Waggle Pi extension/runtime primitive** against the same canonical Pi session/tree.
- Waggle writes to the same canonical branch path as standard mode.
- No hidden child session or hidden sub-branch is created.
- Waggle emits richer runtime metadata/events so UI can render turn attribution truthfully.

## 4.4 Config strategy: `.openwaggle` vs `.pi`

Pi already has a default project-local configuration/resource model under `.pi/`, but OpenWaggle should remain the user-facing product shell.

### Locked product stance
Project-local user-facing config and resources should live under `.openwaggle/`, not `.pi/`.

That means the migrated product should prefer:
- `.openwaggle/settings.json`
- `.openwaggle/skills/`
- `.openwaggle/extensions/`
- `.openwaggle/prompts/`
- `.openwaggle/themes/`
- other OpenWaggle-owned project artifacts under `.openwaggle/`

### Settings file shape
Use a single OpenWaggle-owned JSON settings file:

```json
{
  "someOpenWaggleSetting": true,
  "anotherSetting": "value",
  "pi": {
    "defaultModel": "claude-sonnet-4-5",
    "compaction": {
      "enabled": true
    }
  }
}
```

Rules:
- top-level keys are OpenWaggle-owned product settings
- `pi` contains Pi runtime settings
- do not add an extra `openwaggle` wrapper namespace unless explicitly needed later

### Integration approach
Implement this through:
- a custom Pi `SettingsStorage` / `SettingsManager.fromStorage(...)` integration
- custom resource-loader wiring or configured resource paths so Pi loads project-local skills/prompts/extensions/themes from `.openwaggle/`

### Compatibility precedence
Support legacy project-local directories in this precedence order:
1. `.openwaggle/`
2. `.pi/`
3. `.agents/`

Rules:
- `.openwaggle/` wins when the same resource/config concept exists in multiple places
- `.pi/` is supported for compatibility, not as the primary product-facing namespace
- `.agents/` remains lowest-priority legacy compatibility
- do not force migration in v1; support loading first, decide migration UX later

### Deprecation direction
- `.openwaggle/config.toml` and `.openwaggle/config.local.toml` should be retired from their current runtime role
- approval/trust state in `.openwaggle/config.local.toml` becomes obsolete in v1 because approval UX/policy is removed initially
- Pi runtime config should not surface to users primarily through `.pi/settings.json`

## 4.5 Critical persistence assumption

This blueprint assumes the pragmatic migration default:

- **Pi JSONL remains an internal runtime persistence detail for v1 unless explicitly replaced later**.
- OpenWaggle SQLite remains the canonical product truth.
- Raw Pi JSONL is not user-facing product truth; it is an implementation substrate the runtime needs because the current Pi SDK does not expose a pluggable DB-backed session store.

If later desired, this can evolve to either:
- Pi in-memory only + full OpenWaggle rehydration, or
- a Pi fork/patch with pluggable DB-backed session storage.

## 5. Target persistence model in SQLite

OpenWaggle should stop centering the old flat conversation/message model and instead project Pi-native session trees into a generic typed node graph.

## 5.1 Canonical tables

### `sessions`
Top-level product session rows.

Suggested shape:
- `id` — OpenWaggle product session id
- `pi_session_id` — Pi runtime session id
- `pi_session_file` — nullable/internal runtime pointer if using JSONL-backed Pi sessions in v1
- `project_path`
- `title`
- `archived_at`
- `created_at`
- `updated_at`
- `last_active_node_id`
- `last_active_branch_id`
- `tree_state_json`

### `session_nodes`
Canonical projected node graph.

Suggested shape:
- `id` — use Pi node/entry id wherever possible
- `session_id`
- `parent_id`
- `kind`
  - `user_message`
  - `assistant_message`
  - `tool_result`
  - `custom`
  - `branch_summary`
  - `compaction_summary`
  - `model_change`
  - `thinking_level_change`
  - `session_info`
  - other Pi-native entry kinds as needed
- `role`
- `timestamp`
- `pi_entry_type`
- `content_json`
- `metadata_json`
- `branch_id` or derivable branch lineage info
- `sort_key` / traversal support fields

### `session_branches`
OpenWaggle product read model over the node graph.

Suggested shape:
- `id`
- `session_id`
- `root_node_id` or `branch_from_node_id`
- `head_node_id`
- `name`
- `is_main`
- `future_mode`
- `waggle_config_json` or `waggle_preset_id` + extra branch overrides
- `created_at`
- `updated_at`

### `session_run_state` (optional/lightweight)
Only if needed for active UI restoration, not as canonical history.

Suggested shape:
- `session_id`
- `branch_id`
- `run_mode`
- `status`
- `active_run_id`
- `runtime_json`
- `updated_at`

This should stay lightweight. The canonical history still lives in `session_nodes`.

## 5.2 Projector rules

### Primary rule
- Pi runtime events/session mutations are projected into SQLite immediately.
- SQLite is the canonical product read/write model for OpenWaggle UX.

### Repair rule
- Periodic/checkpoint reconciliation may compare the projected graph with Pi session state.
- Reconciliation is only for repair, not the primary persistence path.

### No raw-event-log default
- Do not persist raw Pi event logs by default.
- If needed later, add optional debug capture only.

## 6. Session/tree/branch model

## 6.1 Session
- Top-level product container shown in the left sidebar.
- Created on first successful Pi session creation triggered by first send.
- Named from first user message, deterministic and editable.

## 6.2 Branch
- Product abstraction over a path/divergence in the Pi tree.
- `main` exists as the initial branch.
- Branches inherit parent future mode/config by default.
- Branch future mode/config is branch-scoped product metadata in OpenWaggle.

## 6.3 Nodes
- Pi node IDs are primary identity wherever possible.
- Structural/system nodes remain visible and navigable.
- Transcript renders the full root-to-active-node path.
- Tree renders the interleaved node sequence, not a collapsed branch-only skeleton.

## 7. Waggle architecture

## 7.1 Runtime model
Waggle is:
- two-agent only in v1
- sequential only in v1
- branch-scoped as a future-run mode
- implemented as a thick Pi-native runtime extension/orchestration primitive
- still OpenWaggle-owned as a product feature

## 7.2 What changes vs standard mode
Only the runtime semantics of how assistant work is produced:
- two agents
- turn attribution
- early-stop logic
- waiting-for-user state
- synthesis
- conflict visibility

All surrounding UX should otherwise behave like standard mode unless explicitly changed.

## 7.3 What should be projected
Waggle should not create a separate canonical history model.
Instead, normal nodes on the same branch path should carry Waggle metadata like:
- `waggle_run_id`
- `agent_slot: a | b | synthesis`
- `turn_index`
- `waggle_status`
- `stop_reason`
- `waiting_for_user_reason`

OpenWaggle may also maintain lightweight branch/run UI state for active rendering.

## 8. IPC and event protocol target

The TanStack-shaped streaming protocol should be replaced by an OpenWaggle-owned Pi-oriented protocol.

## 8.1 Principles
- renderer receives OpenWaggle-native typed events
- protocol is optimized for Pi session/tree runtime and OpenWaggle transcript/tree UX
- no AG-UI compatibility constraints
- no TanStack stream-shape preservation requirements

## 8.2 Event families to support
Suggested families:
- session created / switched / restored
- node appended / node updated
- branch created / branch activated / branch deleted
- active-node changed
- streaming text delta
- tool-call started / updated / completed
- compaction started / completed
- waggle turn started / updated / completed
- waggle state changed (`running`, `waiting-for-user`, `synthesizing`, `completed`, etc.)
- run finished / aborted / failed

## 9. Reuse vs replace

## 9.1 Reuse with minimal semantic change
These areas should stay behaviorally familiar unless Pi constraints force change:
- composer feel and general send flow
- settings information architecture where still truthful
- diff changes flow
- git integration flow
- Waggle presets/team configuration model
- model picker compact interaction
- auto-scroll behavior

## 9.2 Replace fully
These areas are fundamentally tied to TanStack or the old flat-thread model and should be removed/rebuilt:
- TanStack runtime adapters/patches
- TanStack React chat state
- AG-UI-shaped stream types
- flat conversation/message persistence assumptions
- TanStack devtools/event bus surfaces
- old continuation/repair layers built for TanStack behavior
- context inspector / pinned context system in v1 migration

## 10. File-by-file action matrix

## 10.1 Delete outright
- `patches/@tanstack__ai@0.8.1.patch`
- `patches/@tanstack__ai-openai@0.7.1.patch`
- `src/main/adapters/tanstack-chat-adapter.ts`
- `src/main/adapters/tanstack-chat-overload.d.ts`
- `src/main/adapters/continuation-mapper.ts`
- `src/main/providers/tanstack-type-extensions.d.ts`
- `src/shared/types/tanstack-ai-chat.d.ts`
- `src/renderer/src/lib/ipc-connection-adapter.ts`
- `src/renderer/src/lib/stream-chunk-mapper.ts`
- `src/main/devtools/event-bus.ts`
- `src/main/ipc/devtools-handler.ts`
- `src/renderer/src/components/devtools/TanStackAIDevtools.tsx`
- `docs/tanstack-ai-known-issues.md`
- `docs/tanstack-ai-feature-requests.md`

## 10.2 Rewrite heavily
### Runtime / main process
- `src/main/runtime.ts`
- `src/main/agent/agent-loop.ts`
- `src/main/application/agent-run-service.ts`
- `src/main/ipc/agent-handler.ts`
- `src/main/ipc/providers-handler.ts`
- `src/main/ipc/auth-handler.ts`
- `src/main/providers/*`
- `src/main/auth/*`

### Shared types / IPC
- `src/shared/types/ipc.ts`
- `src/shared/types/stream.ts`
- `src/shared/types/continuation.ts`
- likely session/tree domain types around conversations/messages

### Renderer
- `src/renderer/src/hooks/useAgentChat.ts`
- `src/renderer/src/hooks/useAgentChat.utils.ts`
- transcript/session/branch hooks and components tied to flat thread assumptions
- renderer state that assumes TanStack stream chunks or flat conversation history

### Orchestration / Waggle
- `src/main/application/waggle-run-service.ts`
- `src/main/agent/waggle-coordinator.ts`
- `src/main/ipc/waggle-handler.ts`
- `src/main/orchestration/service/deps.ts`
- `src/main/orchestration/service/model-runner.ts`
- `src/main/orchestration/service/types.ts`
- `src/main/orchestration/project-context.ts`

## 10.3 Remove or drastically simplify
### Context / compaction / pinned state
- `src/main/adapters/context-compaction-adapter.ts`
- `src/main/ports/context-compaction-service.ts`
- `src/main/ports/pinned-context-repository.ts`
- `src/main/adapters/sqlite-pinned-context-repository.ts`
- `src/main/store/pinned-context.ts`
- `src/main/services/context-snapshot-service.ts`
- renderer context inspector files
- pinned-message affordances

Target outcome:
- keep only context meter + manual compact action in v1

## 10.4 Likely reusable with adaptation
- settings Waggle preset/team UI (`src/renderer/src/components/settings/sections/WaggleSection.tsx`, related form hook)
- existing model selector and surrounding compact composer chrome patterns
- diff / git integration surfaces, assuming they are decoupled from TanStack chat transport
- current Waggle concepts: turns, synthesis, consensus, file-conflict tracking, preset model

## 11. Recommended migration phases

## Phase 1 — Runtime foundation
- Introduce Pi SDK runtime boundary in main process
- Replace TanStack agent run path with Pi-native session runtime
- Define new OpenWaggle-owned IPC/runtime event protocol
- Keep product UI mostly behaviorally stable while swapping runtime under it where possible

## Phase 2 — Persistence and projection
- Introduce new SQLite session/node/branch projection schema
- Implement projector from Pi session/runtime to SQLite
- Stop relying on flat conversation/message persistence assumptions
- Preserve sidebar/history behavior via new read models

## Phase 3 — Tree-first UI
- Replace flat thread navigation with session + branch tree model
- Rebuild transcript around root-to-active-node path
- Add branch sidebar, collapse state, active-node reveal

## Phase 4 — Waggle on Pi
- Implement thick Pi-native Waggle extension/runtime layer
- Project Waggle metadata into transcript/tree nodes
- Preserve standard-mode behavior everywhere else
- Add branch-scoped future mode/config UI and active Waggle state rendering

## Phase 5 — Cleanup
- Remove remaining TanStack code and docs
- prune learnings/lessons/docs of deprecated runtime assumptions
- update website and internal architecture docs

## 12. First-principles alignment note

This blueprint preserves the current first principles strongly around:
- process isolation
- typed IPC contracts
- streaming as primary data path
- state living at the boundary it serves
- provider/runtime abstraction behind adapters

### One intentional tension
Current `docs/first-principles.md` still encodes approval-centric final authority.
The migration decisions intentionally remove approval UX/policy in v1.

That means this migration is **not literally preserving Principle 9 as currently written**.
The intended product stance is still that the user remains the final authority through explicit mode selection, visibility, stop/cancel controls, and truthful runtime representation — but not through the current per-tool approval model.

This should be documented explicitly when the implementation phase updates first-principles/architecture docs.

## 13. Locked persistence assumption

For the first full migration:
- **keep Pi JSONL internally for migration safety**
- project Pi-native state into SQLite as canonical product truth
- treat Pi JSONL as an internal runtime implementation detail, not product truth

Because the current Pi SDK does not expose a pluggable DB-backed session store, this is the safer first full migration path.
