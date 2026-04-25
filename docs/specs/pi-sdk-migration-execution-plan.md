# Pi SDK Migration Execution Plan

> Historical migration document. This file records the old migration plan and is not the current product/runtime contract. Current behavior is described in `README.md`, `docs/architecture.md`, `docs/system-architecture.md`, and the user guide.

_Status: draft_
_Date: 2026-04-22_
_Related: issue #87, `docs/specs/pi-sdk-migration-discovery.md`, `docs/specs/pi-sdk-migration-blueprint.md`_

## Goal

Turn the migration blueprint into an ordered implementation plan that minimizes scope, preserves working product behavior where requested, and removes TanStack-era runtime assumptions completely.

## Scope guardrails

### Must change
- TanStack AI runtime and renderer integration
- flat conversation/message persistence model
- session/tree/branch product model
- Waggle runtime implementation boundary
- shared IPC/runtime event protocol
- provider/model/auth runtime plumbing to Pi-native model

### Should stay behaviorally familiar unless forced by Pi
- composer feel
- settings IA and Waggle preset/team model
- diff changes flow
- git integration flow
- compact model picker interaction
- transcript auto-scroll behavior

### Compatibility support to preserve
- support legacy project-local config/resource directories with precedence `.openwaggle/` > `.pi/` > `.agents/`
- do not make legacy locations primary again
- do not force migration in v1

## Hexagonal enforcement rule

Every implementation phase must preserve the main-process hexagonal boundary:
- Pi SDK enters through adapters/ports only
- application services orchestrate via `yield*`
- IPC handlers stay transport-thin
- shared types remain OpenWaggle-owned and vendor-free

A migration step that introduces direct Pi imports into `application/`, `ipc/`, or shared IPC/domain types is architecturally invalid even if it appears to speed up the swap.

## Workstream order

1. **Runtime boundary + IPC contract**
2. **SQLite projection schema + repositories/projector**
3. **Renderer state model for sessions/branches/nodes**
4. **Tree-first navigation and transcript**
5. **Waggle on Pi runtime**
6. **Context/compaction simplification**
7. **Provider/auth/settings cleanup**
8. **Delete legacy TanStack/runtime debris**
9. **Docs and roadmap cleanup**

---

# Phase 1 — Establish Pi runtime boundary

## Objective
Replace the TanStack-centric main-process run path with a Pi-native runtime boundary while keeping the surrounding product shell stable enough for incremental migration.

## Files to rewrite first

### Main runtime / agent core
- `src/main/runtime.ts`
- `src/main/agent/agent-loop.ts`
- `src/main/application/agent-run-service.ts`
- `src/main/ipc/agent-handler.ts`

### Shared runtime contracts
- `src/shared/types/ipc.ts`
- `src/shared/types/stream.ts`
- `src/shared/types/continuation.ts`

### Renderer transport consumers
- `src/renderer/src/hooks/useAgentChat.ts`
- `src/renderer/src/hooks/useAgentChat.utils.ts`
- `src/renderer/src/lib/ipc-connection-adapter.ts`
- `src/renderer/src/lib/stream-chunk-mapper.ts`

## Concrete tasks

1. Introduce Pi-backed runtime ports/adapters in main rather than letting Pi SDK leak into application/transport code.
2. Define an OpenWaggle-owned event protocol for:
   - run started/finished/failed
   - node appended/updated
   - active node changes
   - tool call lifecycle
   - compaction lifecycle
   - Waggle lifecycle
3. Stop treating renderer chat transport as TanStack `useChat` compatible.
4. Preserve first-send persistence semantics: the first user turn must still become durable even if the run fails.
5. Keep Pi JSONL as internal runtime persistence for v1.

## Expected deletions after this phase stabilizes
- `src/main/adapters/tanstack-chat-adapter.ts`
- `src/main/adapters/tanstack-chat-overload.d.ts`
- `src/shared/types/tanstack-ai-chat.d.ts`
- `src/renderer/src/lib/ipc-connection-adapter.ts` (replaced, not literally identical path unless convenient)
- `src/renderer/src/lib/stream-chunk-mapper.ts`

## Exit criteria
- Standard single-agent send works through Pi runtime.
- Main process no longer depends on TanStack chat execution to produce assistant output.
- Renderer receives OpenWaggle-native runtime events, not TanStack-shaped stream assumptions.
- No Pi SDK imports leaked into `application/`, `ipc/`, or shared IPC/domain types.

---

# Phase 2 — Replace flat persistence with Pi-native session projection

## Objective
Replace `conversations` + `conversation_messages` + `conversation_message_parts` as the conceptual product core with a session/node/branch projection built around Pi session trees.

## Current persistence to retire conceptually
Current tables in `database-service.ts`:
- `conversations`
- `conversation_messages`
- `conversation_message_parts`
- `pinned_context`

These are centered on flat thread history and should not remain the primary model.

## New tables to introduce
- `sessions`
- `session_nodes`
- `session_branches`
- `session_branch_state`
- `session_tree_ui_state`
- optional lightweight `session_active_runs`

## Files to rewrite / replace
- `src/main/services/database-service.ts`
- `src/main/store/conversations.ts`
- `src/main/adapters/sqlite-conversation-repository.ts`
- `src/main/ports/conversation-repository.ts`
- `src/shared/types/conversation.ts`

## Concrete tasks

1. Add new DB migrations for session/node/branch tables.
2. Introduce a new repository boundary centered on sessions and nodes, not flat conversations.
3. Build a projector that translates Pi session/runtime mutations into SQLite rows.
4. Preserve OpenWaggle-owned metadata:
   - session title
   - archived state
   - active branch per session
   - branch future mode/config
   - tree expand/collapse UI state
5. Keep Pi node IDs as primary node identity wherever possible.
6. Keep reconciliation/checkpoint only as a repair path.

## Exit criteria
- SQLite can represent the full Pi tree.
- Session list + active branch + active node are readable from DB without loading raw Pi JSONL.
- Product UX no longer depends on flattening the tree into old conversation semantics.

---

# Phase 3 — Tree-first renderer state model

## Objective
Replace the flat conversation/thread renderer model with a session + branch + active-node model.

## Files likely requiring major change
- `src/renderer/src/main.tsx`
- chat/session Zustand stores
- transcript hooks/components under `src/renderer/src/components/chat/`
- session sidebar / thread navigation code
- branch-tree sidebar components (new)

## Concrete tasks

1. Replace “active conversation” state with:
   - active session id
   - active branch id
   - active node id
2. Render transcript as root-to-active-node path.
3. Add a second left sidebar for the active session tree.
4. Persist and restore tree expansion state per session.
5. Hide the branch sidebar until branch complexity exists beyond `main`.
6. Preserve current scroll behavior unless tree-first rendering forces a minimal targeted adaptation.

## Exit criteria
- Users can switch sessions and branches.
- Tree reveals active node and ancestors correctly.
- Transcript always matches the selected working context.

---

# Phase 4 — Transcript redesign around node chronology

## Objective
Render the new node graph truthfully, including structural/system nodes, tool chronology, branch divergence, and compaction summary nodes.

## Files likely impacted
- `src/renderer/src/components/chat/ChatRowRenderer.tsx`
- `src/renderer/src/components/chat/useBuildChatRows.ts`
- `src/renderer/src/components/chat/types-chat-row.ts`
- message bubble components
- tool timeline rendering helpers

## Concrete tasks

1. Map `session_nodes` to renderer chat rows instead of flat persisted messages.
2. Render structural/system nodes distinctly.
3. Preserve individual tool-call timeline items with live updates.
4. Add branch divergence marker/styling.
5. Render compaction and branch summary nodes as first-class transcript entries.

## Exit criteria
- Transcript is truthful to the projected node graph.
- Tool chronology is preserved without collapsing/hiding activity.
- Structural/system nodes are navigable and readable.

---

# Phase 5 — Waggle on Pi

## Objective
Rebuild Waggle as a Pi-native thick runtime extension that writes into the same canonical branch path and projects rich turn metadata for the UI.

## Files to replace/rebuild
- `src/main/application/waggle-run-service.ts`
- `src/main/agent/waggle-coordinator.ts`
- `src/main/ipc/waggle-handler.ts`
- Waggle metadata/shared types under `src/shared/types/waggle.ts`
- renderer Waggle transcript/state consumers

## Concrete tasks

1. Keep two-agent sequential-only Waggle for v1.
2. Implement runtime states:
   - idle
   - running
   - waiting-for-user
   - synthesizing
   - completed
   - stopped
   - failed
3. Keep branch-scoped future mode/config in OpenWaggle DB.
4. Keep Waggle writing into the same branch path as standard mode.
5. Lock visible Waggle branch config during active runs.
6. Preserve standard-mode behavior in composer/settings/diff/git unless explicitly changed.

## Exit criteria
- Waggle can be toggled on/off per branch.
- Waiting-for-user pauses and resumes correctly.
- Waggle nodes/events render with truthful turn attribution.
- No hidden sub-branches or hidden multi-session projection are introduced.

---

# Phase 6 — Context / compaction simplification

## Objective
Remove the current TanStack-era context UX complexity and keep only Pi-native essentials.

## Remove or simplify
- `src/main/adapters/context-compaction-adapter.ts`
- `src/main/ports/context-compaction-service.ts`
- `src/main/ports/pinned-context-repository.ts`
- `src/main/adapters/sqlite-pinned-context-repository.ts`
- `src/main/store/pinned-context.ts`
- `src/main/services/context-snapshot-service.ts`
- renderer context inspector components

## Keep in v1
- context meter
- manual compact action
- transcript rendering for compaction summary nodes

## Exit criteria
- No pinned-context/pinned-message flows remain in the migrated runtime.
- Pi compaction can be surfaced with lightweight product UI.

---

# Phase 7 — Provider/model/auth migration cleanup

## Objective
Make Pi runtime truth the backend authority for providers/models/auth while preserving curated OpenWaggle settings UX.

## Files to revisit
- `src/main/providers/*`
- `src/main/ipc/providers-handler.ts`
- `src/main/ipc/auth-handler.ts`
- related settings store / renderer settings UI

## Concrete tasks

1. Audit current settings UI against Pi capabilities.
2. Remove TanStack-specific provider assumptions.
3. Keep compact model picker behavior.
4. Preserve provider/model settings surfaces only where they truthfully reflect Pi runtime options.

## Exit criteria
- Provider/model/auth selection is Pi-native underneath.
- OpenWaggle settings UX remains coherent and honest.

---

# Phase 8 — Delete TanStack-era runtime and devtools debris

## Delete outright
- `patches/@tanstack__ai@0.8.1.patch`
- `patches/@tanstack__ai-openai@0.7.1.patch`
- `src/main/adapters/tanstack-chat-adapter.ts`
- `src/main/adapters/tanstack-chat-overload.d.ts`
- `src/main/adapters/continuation-mapper.ts`
- `src/main/providers/tanstack-type-extensions.d.ts`
- `src/shared/types/tanstack-ai-chat.d.ts`
- `src/main/devtools/event-bus.ts`
- `src/main/ipc/devtools-handler.ts`
- `src/renderer/src/components/devtools/TanStackAIDevtools.tsx`
- `docs/tanstack-ai-known-issues.md`
- `docs/tanstack-ai-feature-requests.md`

## Exit criteria
- Build/test graph no longer references TanStack runtime artifacts.
- Documentation no longer describes TanStack runtime as a product dependency.

---

# Phase 9 — Documentation and knowledge cleanup

## Update
- `docs/system-architecture.md`
- first-principles-adjacent docs that mention old thread model
- website/docs that describe runtime architecture
- `docs/learnings.md` and `docs/lessons.md` prune pass after migration settles

## Exit criteria
- Internal and external docs describe Pi-native runtime and session/tree model truthfully.
- TanStack-specific legacy notes are removed unless still useful historically.

---

# Suggested implementation order inside the repo

## Order of highest leverage
1. New shared session/tree/runtime types
2. New main-process Pi session runtime boundary
3. New DB schema and projector
4. New repositories over sessions/nodes/branches
5. New renderer stores/read models
6. Tree sidebar + transcript path rendering
7. Waggle runtime integration
8. Context simplification
9. Provider/auth/settings cleanup
10. Final delete/prune pass

## Anti-patterns to avoid
- building compatibility bridges from new Pi tree model back into flat conversation semantics
- preserving TanStack stream-shape contracts “just for now”
- rebuilding Waggle as hidden multi-session orchestration
- over-redesigning composer/settings/diff/git where current behavior can be preserved

---

# Verification checkpoints

## After Phase 1
- Standard send works through Pi runtime
- first-send failure still leaves a session in history

## After Phase 2
- full Pi session tree projects into SQLite
- active session/branch/node can be restored from DB

## After Phase 3/4
- tree sidebar and transcript path work together
- branch switching feels correct and stable

## After Phase 5
- Waggle branch mode toggles and runs correctly
- waiting-for-user resumes correctly
- transcript/tree attribution is trustworthy

## After final cleanup
- no TanStack runtime dependency remains
- docs reflect Pi-native architecture
