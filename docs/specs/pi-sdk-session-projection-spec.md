# Pi Session Projection & Projector Spec

> Historical migration document. This file records projection design from the migration work. Current behavior must be verified against `src/main/adapters/pi/`, `src/main/store/sessions.ts`, `src/main/store/session-conversations.ts`, and the active architecture docs.

_Status: draft_
_Date: 2026-04-22_
_Related: `docs/specs/pi-sdk-migration-blueprint.md`_

## Goal

Define the target SQLite model and projection rules for representing Pi-native sessions, trees, and branch-scoped OpenWaggle product metadata.

## Design principles

- Pi runtime/session semantics are the source of truth for session/tree structure.
- OpenWaggle SQLite is the canonical product projection.
- Pi node/entry IDs should be used as primary node identity wherever possible.
- Branch-scoped future mode/config is OpenWaggle-owned metadata.
- Do not persist raw Pi event logs by default.
- Do not preserve old flat conversation compatibility models.

---

# 1. Target tables

## 1.1 `sessions`
Top-level product sessions visible in sidebar 1.

Suggested columns:
- `id TEXT PRIMARY KEY` — OpenWaggle product session id
- `pi_session_id TEXT NOT NULL UNIQUE`
- `pi_session_file TEXT` — internal runtime pointer for v1 JSONL-backed Pi sessions
- `project_path TEXT`
- `title TEXT NOT NULL`
- `archived INTEGER NOT NULL DEFAULT 0`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- `last_active_node_id TEXT`
- `last_active_branch_id TEXT`

Notes:
- `id` remains OpenWaggle-owned so product rows are not forced to equal Pi session ids.
- `pi_session_id` is mandatory because Pi session creation is the first identity event.
- `pi_session_file` is implementation detail only while v1 uses Pi JSONL internally.

## 1.2 `session_nodes`
Canonical projected node graph for a session.

Suggested columns:
- `id TEXT PRIMARY KEY` — Pi entry/node id where available
- `session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE`
- `parent_id TEXT REFERENCES session_nodes(id) ON DELETE CASCADE`
- `pi_entry_type TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `role TEXT`
- `timestamp_ms INTEGER NOT NULL`
- `content_json TEXT NOT NULL`
- `metadata_json TEXT NOT NULL`
- `branch_hint_id TEXT`
- `path_depth INTEGER NOT NULL`
- `created_order INTEGER NOT NULL`

Meaning:
- `pi_entry_type` preserves the underlying Pi type (`message`, `compaction`, `branch_summary`, etc.)
- `kind` is the OpenWaggle UI/domain classification (`user_message`, `assistant_message`, `tool_result`, `custom`, `model_change`, `branch_summary`, `compaction_summary`, etc.)
- `content_json` stores node payload
- `metadata_json` stores UI/runtime metadata such as Waggle info, usage, provider/model, labels, display flags

## 1.3 `session_branches`
Product read model for branch navigation and naming.

Suggested columns:
- `id TEXT PRIMARY KEY`
- `session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE`
- `source_node_id TEXT REFERENCES session_nodes(id)`
- `head_node_id TEXT REFERENCES session_nodes(id)`
- `name TEXT NOT NULL`
- `is_main INTEGER NOT NULL DEFAULT 0`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

Notes:
- `main` is represented explicitly here as the initial product branch.
- Branch rows are derived read models over the node graph, not an alternative canonical history store.

## 1.4 `session_branch_state`
OpenWaggle-owned branch metadata for future runs and branch UX state.

Suggested columns:
- `branch_id TEXT PRIMARY KEY REFERENCES session_branches(id) ON DELETE CASCADE`
- `future_mode TEXT NOT NULL` — `standard` or `waggle`
- `waggle_preset_id TEXT`
- `waggle_config_json TEXT`
- `last_active_at INTEGER NOT NULL`
- `ui_state_json TEXT NOT NULL`

This is where branch-scoped product state lives.

Examples of `ui_state_json` contents:
- locked composer state while run active
- transient visible labels if worth persisting
- future-mode control presentation hints if needed

## 1.5 `session_tree_ui_state`
Session-level tree UI memory.

Suggested columns:
- `session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE`
- `expanded_node_ids_json TEXT NOT NULL`
- `branches_sidebar_collapsed INTEGER NOT NULL DEFAULT 0`
- `updated_at INTEGER NOT NULL`

This keeps tree expansion/collapse state across restarts.

## 1.6 `session_active_runs` (optional/lightweight)
Only for restart-safe UI state, not canonical history.

Suggested columns:
- `session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE`
- `branch_id TEXT NOT NULL REFERENCES session_branches(id) ON DELETE CASCADE`
- `run_id TEXT PRIMARY KEY`
- `run_mode TEXT NOT NULL`
- `status TEXT NOT NULL`
- `runtime_json TEXT NOT NULL`
- `updated_at INTEGER NOT NULL`

Use sparingly.

---

# 2. Node content rules

## 2.1 Message-derived nodes
Pi message entries become `session_nodes` with one row per Pi entry.

Examples:
- user message
- assistant message
- tool result message
- bash execution message
- custom message

## 2.2 Structural/system nodes
These must remain first-class nodes in projection and UI.

Examples:
- `compaction`
- `branch_summary`
- `model_change`
- `thinking_level_change`
- `session_info`
- extension-defined custom entries/messages where surfaced

## 2.3 Tool chronology
Assistant/tool chronology should remain truthful.

Recommended rule:
- preserve assistant node content as emitted by Pi
- renderer derives tool timeline rows from node content/metadata
- do not collapse or aggregate multiple tool calls into a fake single action row

---

# 3. Branch derivation rules

## 3.1 Canonical history
Canonical history is the `session_nodes` parent/child graph.

## 3.2 Product branch read model
Branches are a projection/read model for navigation, naming, and branch-local product state.

### Main branch
- created for the initial root-to-head path
- non-renamable
- non-deletable

### Derived branches
A branch row is created when Pi tree divergence produces a new navigable path beyond `main`.

Suggested derivation inputs:
- branch source node
- current branch head
- first divergent child path

## 3.3 Active branch
- stored on `sessions.last_active_branch_id`
- restored when switching sessions

---

# 4. Waggle projection rules

Waggle uses the same canonical branch path as standard mode.

## 4.1 Do not create a separate history model
Do not introduce a second canonical table for Waggle transcript history.

## 4.2 Encode Waggle in node metadata
Suggested `metadata_json` fields on affected nodes:
- `waggleRunId`
- `agentSlot` — `a | b | synthesis`
- `turnIndex`
- `waggleStatus`
- `stopReason`
- `waitingForUserReason`
- `presetId` or configuration snapshot if useful for auditability

## 4.3 Branch future mode is not runtime truth
Branch future mode/config belongs in `session_branch_state`, not inside Pi session truth.

---

# 5. Projector responsibilities

## 5.1 Inputs
The projector consumes Pi-native runtime/session state transitions, not TanStack-shaped stream assumptions.

Potential sources:
- Pi session creation result
- Pi session tree mutations after prompt/steer/followUp/branch/compact
- Waggle runtime state events
- session switch/navigation events

## 5.2 Outputs
The projector must maintain:
- `sessions`
- `session_nodes`
- `session_branches`
- `session_branch_state`
- `session_tree_ui_state`
- optional `session_active_runs`

## 5.3 Projection strategy
### Primary path
- project incrementally from runtime/session events as they occur

### Repair path
- periodically reconcile from Pi session snapshot/tree
- use only to repair missed or partial projections

### No raw-event-log default
- do not persist a separate raw event stream by default

---

# 6. Session creation flow

Because Pi session creation is the first identity event:

1. user sends first message
2. main process creates Pi session/runtime
3. projector inserts `sessions` row using Pi session identity mapping
4. projector inserts initial root nodes as they appear
5. renderer shows the new session immediately

If the first assistant run fails after creation:
- keep the session row
- keep the first user node
- reflect failure through run/node metadata rather than deleting the session

---

# 7. Session restart and reconciliation

## v1 assumption
- Pi JSONL remains internal runtime persistence
- SQLite remains canonical product projection

## On app startup
Recommended recovery path:
1. load projected sessions from SQLite for product UI
2. lazily reconnect runtime to Pi session files as needed for active/open sessions
3. if reconciliation detects mismatch, repair projection from Pi session snapshot/tree

## In-flight run recovery
If runtime process dies mid-run, product projection should prefer:
- preserving already-projected nodes
- marking run interrupted/stopped in lightweight run state
- not attempting magical full runtime continuation unless Pi supports it cleanly

---

# 8. Migration from current schema

Current tables to conceptually retire:
- `conversations`
- `conversation_messages`
- `conversation_message_parts`
- `pinned_context`

## Migration rule
Do not build a permanent compatibility layer that treats sessions as flat conversations.

Instead:
- introduce new tables
- migrate/retire old data path
- cut renderer/main code over to the new projection model
- remove old flat persistence assumptions once the new path is stable

---

# 9. Repository split recommendation

Recommended new ports/adapters:
- `SessionRepository`
- `SessionNodeRepository`
- `SessionBranchRepository`
- `SessionProjectionRepository` or `SessionProjector`

Avoid extending `ConversationRepository` indefinitely. The name encodes the old model.

---

# 10. Queries the renderer should rely on

Recommended read models/API shape:
- list sessions with title, last branch label, updated time
- get session tree for active session
- get active transcript path for `(sessionId, nodeId)`
- get branch metadata for active branch
- get session UI state (tree expansion, collapsed sidebar)

The renderer should not need to flatten raw node storage manually on every screen.
