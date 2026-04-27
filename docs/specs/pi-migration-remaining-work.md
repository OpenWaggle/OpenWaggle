# Pi Migration Remaining Work

_Status: active follow-up spec_  
_Created: 2026-04-27_  
_Replaces audited/deleted historical specs:_

- `docs/specs/pi-sdk-migration-blueprint.md`
- `docs/specs/pi-sdk-migration-discovery.md`
- `docs/specs/pi-sdk-migration-execution-plan.md`
- `docs/specs/pi-sdk-migration-sequencing.md`
- `docs/specs/pi-sdk-session-projection-spec.md`

## Purpose

This spec records only the actionable Pi-migration work that remains after reconciling the deleted migration specs against the current codebase.

The current implementation already has the core Pi runtime boundary, Pi-derived provider/model/auth wiring, project-local `.openwaggle/settings.json` Pi settings bridge, SQLite session projection tables, Pi session snapshot persistence, and root-to-active-node transcript rendering. Those completed areas are not restated as work items here.

## Current-source constraints

Use these as the source of truth when implementing this remaining work:

- `docs/first-principles.md`
  - Pi is the runtime kernel.
  - Runtime capabilities come from Pi first.
  - OpenWaggle owns typed IPC, UI state, and SQLite product projection.
  - No hidden orchestration should stand in for real Pi session/tree structure.
- `docs/lessons.md`
  - Do **not** implement the old permanent second branch sidebar. Branches belong nested under their owning session in the project/session sidebar.
  - Branch/fork controls should live on nodes, with a draft branch shown under the session until the next send materializes the Pi branch.
- `docs/architecture.md` and `docs/system-architecture.md`
  - Pi SDK imports stay confined to `src/main/adapters/pi/`.
  - Application and IPC code depend on OpenWaggle-owned ports and DTOs.

## Explicit non-goals

Do not use this spec to revive deleted runtime/product surfaces:

- no removed vendor-runtime chat transport
- no deprecated external stream-shape contract
- no old flat-message SQLite tables as product truth
- no removed context side-panel or pinned-context system in this migration follow-up
- no legacy tool-gating product flow; future runtime policy controls must be a new Pi-native/product feature
- no permanent second branch sidebar
- no fake projection-only branch deletion that leaves Pi session/tree truth unchanged

---

## 0. Project-local resource precedence hardening

### Problem

OpenWaggle is the user-facing project namespace, but Pi's default resource loader merges additional skill/prompt/extension/theme paths after Pi-discovered paths. If two resources collide by id/name, `.openwaggle/` may not actually take precedence over `.pi/` or `.agents/`.

Evidence:

- Current OpenWaggle adapter adds `.openwaggle/*` through `additional*Paths`:
  - `src/main/adapters/pi/pi-provider-catalog.ts`
- Pi `DefaultResourceLoader` merges `additionalSkillPaths` after resolved default skill paths:
  - `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js`
- Existing tests verify loading and toggles, but not collision precedence:
  - `src/main/adapters/pi/__tests__/pi-provider-catalog.unit.test.ts`

### Required behavior

1. `.openwaggle/` resources must be the primary OpenWaggle-facing project resources.
2. Legacy Pi/user-agent resource locations remain supported as fallback/discovery sources.
3. Effective project-local precedence must be `.openwaggle/` first, then `.pi/`, then `.agents/`, without breaking Pi global/user resources.
4. OpenWaggle catalog toggles continue to apply to `.openwaggle/skills` and root `.agents/skills`; Pi-native `.pi/skills` remains Pi-owned unless a future product decision changes that.
5. Resource `sourceInfo`/diagnostics should remain truthful after any reordering/filtering.

### Implementation outline

1. Add collision-precedence tests for skills first, then prompts/extensions/themes as needed.
2. Prefer Pi public exports and resource-loader override hooks; avoid deep private imports.
3. If Pi's default loader cannot express the needed precedence, build ordered resource lists with public package/resource APIs, then feed a deterministic ordered result through `skillsOverride`, `promptsOverride`, `themesOverride`, and extension handling.
4. Keep all custom resource ordering confined to the Pi adapter layer.
5. Document any Pi SDK limitation or workaround in `.openwaggle/skills/pi-integration/SKILL.md`.

### Acceptance criteria

- Given the same skill id in `.openwaggle/skills`, `.pi/skills`, and `.agents/skills`, the `.openwaggle` skill wins.
- Removing the `.openwaggle` copy falls back to `.pi`, then `.agents`.
- Disabled OpenWaggle catalog skills remain filtered out.
- Diagnostics still point at the actual resource file that was loaded or suppressed.

---

## 1. Session tree UX parity

### Problem

The database and shared types can represent a Pi session tree, but the renderer does not yet expose the full interleaved node graph. The current sidebar renders nested branch rows under the active session, not the full Pi node sequence.

Evidence:

- Projection/types exist:
  - `src/shared/types/session.ts`
  - `src/main/services/database-service.ts`
  - `src/main/store/sessions.ts`
- Current branch UI maps `activeSessionTree.branches`, not `activeSessionTree.nodes`:
  - `src/renderer/src/components/layout/Sidebar.tsx`
- No renderer UI writes `session_tree_ui_state.expanded_node_ids_json`.
- No IPC method currently updates tree expansion/collapse state:
  - `src/shared/types/ipc.ts`
  - `src/preload/api.ts`
  - `src/main/ipc/sessions-handler.ts`

### Required behavior

Implement a node-tree UI inside the current project/session sidebar model:

1. Render the full interleaved visible node sequence for the active session under its session row.
2. Keep branches nested under the owning session; do not add a permanent second sidebar.
3. Show node type distinctions for at least:
   - user message
   - assistant message
   - tool result
   - compaction summary
   - branch summary
   - model/thinking/session/system/custom timeline entries when surfaced
4. Clicking a visible node must navigate the working context to that node.
5. Active node must be auto-revealed and its ancestors expanded.
6. Users must be able to manually expand/collapse tree sections.
7. Expansion state must persist per session across restarts.
8. Draft branches must continue to appear under the owning session until the next send materializes the branch in Pi.
9. Branch/fork controls must be available from node rows where Pi semantics allow branching.

### Implementation outline

1. Add a focused tree component, for example:
   - `src/renderer/src/components/layout/SessionNodeTree.tsx`
   - `src/renderer/src/components/layout/SessionNodeTreeRow.tsx`
2. Keep it self-wired through `useSessionStore`/route hooks where possible; avoid large pass-through controller props.
3. Add IPC to persist UI state, for example:
   - `sessions:update-tree-ui-state(sessionId, patch)`
   - patch fields: `expandedNodeIds`, `branchesSidebarCollapsed` only if a collapsed branch section still exists in the nested-sidebar design
4. Add `SessionRepository` methods for tree UI state updates rather than writing SQLite directly from IPC.
5. Keep the persistence adapter in `src/main/store/` and the port in `src/main/ports/`.
6. Preserve route search params for active `branch` and `node`.
7. If a selected node no longer exists in Pi, reuse the existing stale-node cancellation behavior and refresh the workspace from the latest projection.

### Acceptance criteria

- A branched session shows its visible Pi node graph under the session row.
- Selecting a node updates the route and transcript to the root-to-selected-node path.
- Active node reveal works after session switch, branch switch, app reload, and manual node navigation.
- Manual expansion/collapse survives app restart.
- Draft branch rows still work and do not call Pi navigation until materialization on send.
- No second permanent branch sidebar is introduced.

---

## 2. Transcript structural/timeline node rendering

### Problem

The backend preserves structural node kinds, but the renderer mostly converts projected nodes into `UIMessage`s. Nodes without hydrated messages are skipped, and branch summaries are currently rendered as plain assistant text rather than differentiated timeline rows.

Evidence:

- Node kinds exist in `src/shared/types/session.ts`.
- Pi entries are mapped to structural kinds in `src/main/adapters/pi/pi-agent-kernel-adapter.ts`.
- `workspacePathToMessages()` skips transcript path entries without `node.message`:
  - `src/renderer/src/components/chat/session-workspace-transcript.ts`
- `ChatRow` currently supports message, compaction summary, phase indicator, run summary, and error only:
  - `src/renderer/src/components/chat/types-chat-row.ts`
  - `src/renderer/src/components/chat/ChatRowRenderer.tsx`

### Required behavior

1. Render the transcript from `SessionWorkspace.transcriptPath`, not only from hydrated messages.
2. Add first-class row types for structural/timeline entries:
   - branch summary
   - model change
   - thinking level change
   - session info
   - label/custom entries that are meant to display
3. Keep compaction summaries as first-class cards.
4. Add branch divergence markers/styling when the current path leaves shared history.
5. Preserve tool chronology. Do not collapse multiple tool calls into one fake grouped item.
6. Keep live streaming tail behavior unchanged: append unsaved live tail only when viewing the active branch head or draft branch source.

### Implementation outline

1. Introduce a `SessionTranscriptRow` derivation step that accepts:
   - `SessionWorkspace.transcriptPath`
   - live `UIMessage[]`
   - run/loading state
   - draft branch source node id
2. Extend `ChatRow` or introduce a session-native row union with structural row variants.
3. Keep `UIMessage` as the message row payload; do not force all session nodes through `UIMessage`.
4. Add components for timeline rows, for example:
   - `BranchSummaryRow`
   - `SessionTimelineRow`
   - `BranchDivergenceMarker`
5. Update component tests for:
   - branch summary row
   - model/thinking/session/custom row display
   - skipped hidden custom Waggle prompts
   - live tail preservation at active head

### Acceptance criteria

- A transcript path containing structural nodes renders them visibly and distinctly.
- Branch summaries are not plain assistant bubbles.
- Branch divergence is visible without overwhelming the transcript.
- Existing compaction summary cards and tool-call rendering still work.
- Hidden internal Waggle prompt custom messages remain hidden from product transcript UI.

---

## 3. Branch metadata and actions

### Problem

Branch rows are derived and displayed, but branch actions remain incomplete. Auto-naming exists; user-facing branch rename/delete and active branch labels on session rows do not.

Evidence:

- Auto branch naming is implemented in `src/main/store/session-conversations.ts`.
- `SessionListItem` renders title and updated time only:
  - `src/renderer/src/components/layout/SessionListItem.tsx`
- Session branch IPC currently has list/get/navigate only:
  - `src/shared/types/ipc.ts`
  - `src/preload/api.ts`
  - `src/main/ipc/sessions-handler.ts`
- `BranchRows` are buttons without action menus:
  - `src/renderer/src/components/layout/Sidebar.tsx`

### Required behavior

1. Show the active branch label subtly on the active session row, while keeping rows single-line.
2. Allow user branch rename for non-main branches.
3. Preserve manual branch names across subsequent Pi snapshot projections.
4. Keep `main` non-renamable.
5. Add branch delete only if the implementation can mutate Pi session/tree truth, not merely hide a projected read-model row.
6. Keep `main` non-deletable.
7. If branch deletion becomes supported, deleting a branch must delete the subtree and activate the nearest surviving parent branch when the deleted subtree was active.

### Implementation outline

1. Add read-model data needed for active branch label:
   - either include active branch display data in `SessionSummary`, or derive it from the active tree for the selected session.
2. Add session branch mutation APIs for rename:
   - `sessions:rename-branch(sessionId, branchId, name)`
   - implement through `SessionRepository` and `session_branches.name`
3. Ensure `persistSessionSnapshot()` preserves existing non-main branch names when branch identity remains stable.
4. Investigate Pi SDK support before adding delete:
   - if Pi supports subtree deletion, add an `AgentKernelService` operation and project the resulting snapshot;
   - if Pi does not support it, leave delete unimplemented rather than faking it in SQLite.

### Acceptance criteria

- Session rows display current branch context without adding a second line.
- Renaming a non-main branch updates sidebar/header labels immediately and survives another run snapshot.
- `main` rename/delete actions are unavailable.
- No branch delete UI ships unless Pi session truth is actually mutated.

---

## 4. Branch-scoped Waggle future mode/config

### Problem

The schema supports branch future mode/config, and Waggle writes metadata after runs, but the visible Waggle configuration is still conversation/store-scoped in renderer behavior. There is no branch-state mutation IPC for pre-run configuration, inheritance, or active-run locking.

Evidence:

- Branch state schema exists:
  - `src/main/services/database-service.ts`
  - `src/shared/types/session.ts`
- Snapshot persistence can write active branch Waggle config:
  - `src/main/store/session-conversations.ts`
  - `src/main/application/waggle-run-service.ts`
- Renderer Waggle store is conversation-scoped:
  - `src/renderer/src/stores/waggle-store.ts`
- Current session IPC has no branch state mutation channels:
  - `src/shared/types/ipc.ts`

### Required behavior

1. Waggle future mode/config must be branch-scoped product state.
2. Composer controls must reflect the current branch state only.
3. Updating Waggle config on one branch must not mutate other branches.
4. New draft/materialized child branches must inherit the parent branch future mode/config by default.
5. Users can change inherited config before sending on that branch.
6. Visible Waggle branch config is locked while that branch has an active Waggle run.
7. Standard-mode and Waggle-mode turns continue writing to the same canonical Pi branch path.
8. Waggle turn attribution remains persisted in node metadata.

### Implementation outline

1. Add branch state mutation APIs:
   - `sessions:update-branch-state(sessionId, branchId, patch)`
   - patch fields: `futureMode`, `waggleConfig`, optional UI lock state if persisted
2. Move renderer Waggle configuration reads/writes from conversation-level state to active `SessionWorkspace.activeBranchState` plus optimistic branch-local UI state.
3. On draft branch creation, copy parent branch state into draft UI state.
4. On branch materialization, persist inherited branch state with the new derived branch identity.
5. Store active-run locks either in `session_active_runs` or in `session_branch_state.ui_state_json`, depending on whether restart-safe run status is required.
6. Keep Waggle orchestration through the existing Pi session/custom-message adapter path unless a later Pi extension has a concrete product/runtime reason.

### Acceptance criteria

- Enabling/disabling Waggle on one branch does not affect another branch.
- A child branch inherits parent Waggle mode/config before first send.
- The composer always makes the active branch mode visible.
- Active Waggle run config cannot be edited until the run stops/completes/fails.
- Persisted branch state survives app restart and another Pi session snapshot.

---

## 5. Waggle runtime state completeness

### Problem

Current Waggle supports two-agent sequential turns, synthesis, basic turn attribution, and same-session Pi snapshots. Missing runtime/product states from the reconciled specs include waiting-for-user/resume, explicit synthesis/failure status, and richer persisted run outcome metadata.

Evidence:

- Waggle statuses are currently `idle`, `running`, `paused`, `completed`, `stopped`:
  - `src/shared/types/waggle.ts`
- `synthesis-start` updates the current agent label but not a dedicated status:
  - `src/renderer/src/stores/waggle-store.ts`
- No waiting-for-user event/resume path exists in current `WaggleTurnEvent`.
- Persisted metadata has attribution fields but not status/stop/waiting fields:
  - `src/shared/schemas/waggle.ts`
  - `src/main/application/waggle-run-service.ts`

### Required behavior

1. Add explicit Waggle states for:
   - synthesizing
   - waiting-for-user
   - failed
2. Define how a Waggle run pauses for user input and resumes on the same branch when the user replies.
3. Persist enough node/run metadata to audit:
   - run id
   - agent slot or synthesis role
   - turn index
   - status/outcome
   - stop reason
   - waiting-for-user reason when applicable
4. Keep visible user replies in the normal transcript position.
5. Turning Waggle off affects future behavior only; stopping/cancelling remains a separate explicit action.

### Implementation outline

1. Extend `WaggleCollaborationStatus`, `WaggleTurnEvent`, schemas, and renderer store handling.
2. Add application-service semantics for waiting-for-user:
   - detect runtime condition
   - persist/emit pause state
   - hold or reconstruct continuation metadata
   - resume on next user reply if branch mode/run state still indicates waiting
3. Decide whether waiting state lives in `session_active_runs` or branch UI state.
4. Add tests around pause/resume, stop, future-mode toggle during wait, and synthesis status transitions.

### Acceptance criteria

- Waiting-for-user appears as a first-class UI/run state.
- A user reply resumes the same branch/run unless the user explicitly stops it first.
- Synthesis has a visible distinct state.
- Failed Waggle runs surface a failed state and actionable error.
- Persisted Waggle node/run metadata remains valid after reload.

---

## 6. Projection durability and restart-safe run state

### Problem

The current persistence path projects full Pi session snapshots after completed runtime operations. This is simple and aligns with the current architecture, but the deleted projection spec also required incremental durability for runtime/session mutations and restart-safe active run state. The current `session_active_runs` table is unused.

Evidence:

- Pi snapshot projection is built from `session.sessionManager.getEntries()`:
  - `src/main/adapters/pi/pi-agent-kernel-adapter.ts`
- Standard run persists after `agentKernel.run()` returns:
  - `src/main/application/agent-run-service.ts`
- Snapshot persistence deletes `session_active_runs` and there is no insert/update path:
  - `src/main/store/session-conversations.ts`
- Active run tracking is currently in memory:
  - `src/main/ipc/active-agent-runs.ts`
  - `src/main/ipc/agent-handler.ts`
  - `src/main/ipc/waggle-handler.ts`

### Required behavior

1. Preserve the first user node when a first run fails after Pi session creation and prompt acceptance.
2. Avoid losing already-emitted/runtime-known nodes if the app process dies before a full run completes.
3. Use `session_active_runs` only for lightweight restart-safe UI/run state, not as canonical transcript history.
4. Do not persist a raw Pi event log by default.
5. Keep full snapshot reconciliation as the repair/checkpoint path.

### Implementation outline

1. Add minimal incremental projection at durability boundaries rather than a broad raw-event log:
   - after visible user prompt node is created
   - after assistant message end
   - after compaction summary creation
   - after branch navigation/summary mutation
2. Alternatively, if Pi exposes a cheap current snapshot during stream events, persist partial snapshots after stable node boundaries.
3. Insert/update `session_active_runs` when a standard or Waggle run starts, changes status, waits, stops, fails, or completes.
4. Clear active run rows only after terminal projection is safely persisted.
5. On startup, surface interrupted/stopped UI state rather than attempting magical runtime continuation unless Pi exposes a clean continuation API.

### Acceptance criteria

- Killing the app mid-run does not delete session identity or already-durable visible user input.
- Restarted app can show interrupted active-run state for sessions that were mid-run.
- Successful completed runs still end with a reconciled full Pi session snapshot.
- No raw event-log table is introduced.

---

## 7. Session-native naming cleanup

### Problem

The physical persistence model is now session-native, but a conversation-shaped compatibility/read-model layer and some test/user-facing copy remain. This does not block runtime correctness, but it does keep old mental models alive for future maintainers.

Evidence:

- `SessionProjectionRepository` exposes `Conversation` DTOs:
  - `src/main/ports/session-projection-repository.ts`
- IPC still includes `conversations:*` channels:
  - `src/shared/types/ipc.ts`
- Renderer chat state still uses `activeConversationId` naming:
  - `src/renderer/src/stores/chat-store.ts`
  - `src/renderer/src/hooks/useChat.ts`
- Some E2E helper/test names still use “thread”.

### Required behavior

1. Preserve product behavior while gradually renaming public/internal surfaces to session-native names.
2. Do not reintroduce flat persistence tables or a separate flat transcript model.
3. Keep compatibility shims only where necessary during the transition, and document them as temporary.

### Implementation outline

1. Add session-native IPC channels before removing `conversations:*` channels.
2. Rename renderer active state from conversation to session in focused slices.
3. Rename test helpers from thread/conversation where they are no longer accurate.
4. Keep branded type boundaries (`SessionId`, `SessionNodeId`, `SessionBranchId`) explicit.

### Acceptance criteria

- New code paths use session terminology.
- User-facing errors and UI copy say “session”.
- Compatibility names are either removed or explicitly isolated.
- No product screen depends on flattening the session tree into old flat-message assumptions.

---

## Audited items intentionally not carried forward

These deleted-spec requirements were reviewed and are not current remaining work:

1. **Permanent second branch sidebar** — superseded by current lesson: branches/nodes belong under their owning session in the main project/session sidebar.
2. **Thick Waggle Pi extension as a migration requirement** — current architecture uses OpenWaggle application-layer Waggle orchestration over Pi session/custom-message primitives. Keep this unless a future Pi extension provides a concrete simplification or capability need.
3. **Independent product session id value** — current clean-cut creation uses Pi session creation as the first identity event and stores the Pi id in the branded OpenWaggle session id value. Revisit only if a future Pi session identity limitation requires separate product identity.
4. **Legacy tool-gating flow** — removed from the migration target. Future runtime policy controls must be designed fresh and kept behind Pi adapter/product boundaries.

## Minimal verification matrix for implementations from this spec

For any implementation work against this spec:

1. `pnpm typecheck:node`
2. `pnpm typecheck:web`
3. `pnpm check:architecture`
4. Relevant unit/integration/component tests near the changed feature
5. If renderer code changes: `npx -y react-doctor@latest . --verbose --diff main`
6. If renderer/preload/IPC changes: Electron QA in the real app via CDP, following `.agents/skills/electron-qa/SKILL.md`
7. If session tree/branch UX changes: one E2E or live-QA path covering branch creation, branch switch, node navigation, app reload, and transcript path correctness
