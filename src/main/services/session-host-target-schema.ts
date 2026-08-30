import { SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS } from './session-host-attachment-schema'
import { SESSION_DELEGATION_TARGET_SCHEMA_STATEMENTS } from './session-host-delegation-schema'
import { SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS } from './session-host-export-schema'
import { SESSION_LIFECYCLE_RESOURCE_SCHEMA_STATEMENTS } from './session-host-lifecycle-resource-schema'
import { SESSION_ORCHESTRATION_TARGET_SCHEMA_STATEMENTS } from './session-host-orchestration-schema'
import { SESSION_PROFILE_TARGET_SCHEMA_STATEMENTS } from './session-host-profile-schema'
import { SESSION_REPORT_TARGET_SCHEMA_STATEMENTS } from './session-host-report-schema'
import {
  SESSION_HOST_FRESH_REVISION,
  SESSION_HOST_SCHEMA_REVISION,
} from './session-host-schema-identity'

export const SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_host_schema_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_revision INTEGER NOT NULL,
    migration_revision TEXT NOT NULL,
    source_high_watermark_json TEXT NOT NULL,
    completed_at INTEGER NOT NULL
  )
  `,
  `
  INSERT INTO session_host_schema_metadata (
    singleton, schema_revision, migration_revision, source_high_watermark_json, completed_at
  ) VALUES (
    1, ${SESSION_HOST_SCHEMA_REVISION}, '${SESSION_HOST_FRESH_REVISION}', '{}',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  )
  `,
  `
  CREATE TABLE workspace_resources (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('local', 'managed-worktree')),
    working_path TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL CHECK (
      lifecycle_state IN ('pending', 'materializing', 'ready', 'missing', 'releasing', 'failed')
    ),
    worktree_branch TEXT,
    worktree_base_ref TEXT,
    handoff_seed_ref TEXT,
    handoff_seed_base_ref TEXT,
    handoff_seed_state TEXT NOT NULL DEFAULT 'none' CHECK (
      handoff_seed_state IN ('none', 'pending', 'applied', 'failed')
    ),
    worktree_start_from_origin INTEGER NOT NULL DEFAULT 0 CHECK (
      worktree_start_from_origin IN (0, 1)
    ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (project_path, working_path)
  )
  `,
  `
  CREATE INDEX idx_workspace_resources_project_kind
  ON workspace_resources (project_path, kind, lifecycle_state, id)
  `,
  `
  CREATE TABLE session_workspace_bindings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspace_resources(id),
    bound_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_workspace_bindings_workspace
  ON session_workspace_bindings (workspace_id, session_id)
  `,
  `
  CREATE TABLE session_derivations (
    derived_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    source_session_id TEXT NOT NULL REFERENCES sessions(id),
    source_node_id TEXT NOT NULL,
    position TEXT NOT NULL CHECK (position IN ('before', 'at')),
    created_at INTEGER NOT NULL,
    CHECK (derived_session_id <> source_session_id)
  )
  `,
  `
  CREATE INDEX idx_session_derivations_source
  ON session_derivations (source_session_id, created_at, derived_session_id)
  `,
  `
  CREATE TABLE session_execution_profiles (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    profile_json TEXT NOT NULL,
    resolved_agent_snapshot_json TEXT,
    authority_origin_caller_id TEXT NOT NULL,
    authority_scope_snapshot_json TEXT,
    authorization_ceiling TEXT NOT NULL CHECK (
      authorization_ceiling IN ('yolo', 'ask-for-approval')
    ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  ...SESSION_LIFECYCLE_RESOURCE_SCHEMA_STATEMENTS,
  `
  CREATE TABLE session_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN (
      'starting', 'active', 'stopping', 'completed', 'failed', 'interrupted',
      'interrupted-by-host-loss', 'interrupted-by-interaction-timeout'
    )),
    intent_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_session_runs_session_status
  ON session_runs (session_id, status, updated_at DESC, id)
  `,
  `
  CREATE TABLE session_authorization_requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES session_runs(id) ON DELETE CASCADE,
    request_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
    decision_reason TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    CHECK (
      (status = 'pending' AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_at IS NOT NULL)
    )
  )
  `,
  `
  CREATE INDEX idx_session_authorization_requests_run_status
  ON session_authorization_requests (run_id, status, created_at, id)
  `,
  `
  CREATE TABLE session_spawn_lineage (
    child_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id),
    parent_run_id TEXT NOT NULL REFERENCES session_runs(id),
    hive_root_session_id TEXT NOT NULL REFERENCES sessions(id),
    depth INTEGER NOT NULL CHECK (depth > 0),
    origin_operation_id INTEGER,
    created_at INTEGER NOT NULL,
    CHECK (child_session_id <> parent_session_id),
    CHECK (child_session_id <> hive_root_session_id OR depth = 0)
  )
  `,
  `
  CREATE INDEX idx_session_spawn_lineage_parent
  ON session_spawn_lineage (parent_session_id, created_at, child_session_id)
  `,
  `
  CREATE INDEX idx_session_spawn_lineage_hive
  ON session_spawn_lineage (hive_root_session_id, depth, child_session_id)
  `,
  `
  CREATE TABLE delegation_contracts (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id),
    child_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
      'working', 'waiting', 'needs_attention', 'ready_for_review',
      'revision_requested', 'accepted', 'cancelled'
    )),
    current_specification_revision INTEGER NOT NULL CHECK (current_specification_revision > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX idx_delegation_contracts_parent_state
  ON delegation_contracts (parent_session_id, state, updated_at DESC, id)
  `,
  `
  CREATE TABLE delegation_specifications (
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    specification_json TEXT NOT NULL,
    authored_by TEXT NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (delegation_id, revision)
  )
  `,
  `
  CREATE TABLE delegation_dependencies (
    delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    dependency_delegation_id TEXT NOT NULL REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    required_state TEXT NOT NULL CHECK (required_state IN ('ready_for_review', 'accepted')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (delegation_id, dependency_delegation_id),
    CHECK (delegation_id <> dependency_delegation_id)
  )
  `,
  `
  CREATE INDEX idx_delegation_dependencies_target
  ON delegation_dependencies (dependency_delegation_id, required_state, delegation_id)
  `,
  ...SESSION_DELEGATION_TARGET_SCHEMA_STATEMENTS,
  ...SESSION_EXPORT_TARGET_SCHEMA_STATEMENTS,
  ...SESSION_REPORT_TARGET_SCHEMA_STATEMENTS,
  ...SESSION_ORCHESTRATION_TARGET_SCHEMA_STATEMENTS,
  `
  CREATE TABLE derived_child_management_grants (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id),
    child_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    delegation_id TEXT NOT NULL UNIQUE REFERENCES delegation_contracts(id) ON DELETE CASCADE,
    source_caller_id TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    authorization_ceiling TEXT NOT NULL CHECK (
      authorization_ceiling IN ('yolo', 'ask-for-approval')
    ),
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  )
  `,
  ...SESSION_PROFILE_TARGET_SCHEMA_STATEMENTS,
  `
  CREATE TABLE session_control_states (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    state_revision INTEGER NOT NULL CHECK (state_revision >= 0),
    active_run_id TEXT REFERENCES session_runs(id),
    queue_state TEXT NOT NULL CHECK (queue_state IN ('running', 'paused')),
    queue_revision INTEGER NOT NULL CHECK (queue_revision >= 0),
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE session_follow_ups (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    delivery_state TEXT NOT NULL CHECK (delivery_state IN ('pending', 'needs_attention')),
    attention_reason TEXT CHECK (
      attention_reason IN ('authorization_ceiling_changed', 'profile_revoked', 'authority_changed')
    ),
    intent_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (session_id, position),
    CHECK (
      (delivery_state = 'pending' AND attention_reason IS NULL)
      OR (delivery_state = 'needs_attention' AND attention_reason IS NOT NULL)
    )
  )
  `,
  `
  CREATE INDEX idx_session_follow_ups_delivery
  ON session_follow_ups (session_id, delivery_state, position, id)
  `,
  `
  CREATE TABLE session_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    target_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
    outcome_json TEXT,
    cleanup_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (
      (status = 'pending' AND outcome_json IS NULL)
      OR (status = 'completed' AND outcome_json IS NOT NULL)
    ),
    UNIQUE (caller_id, operation, target_scope, idempotency_key)
  )
  `,
  `
  CREATE INDEX idx_session_operations_created
  ON session_operations (created_at DESC, id DESC)
  `,
  `
  CREATE INDEX idx_session_operations_pending_target
  ON session_operations (target_scope, operation, status, id)
  `,
  ...SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS,
] as const

export { SESSION_SEARCH_TARGET_SCHEMA_STATEMENTS } from './session-host-search-schema'

import { SESSION_SEARCH_TARGET_SCHEMA_STATEMENTS } from './session-host-search-schema'

export const SESSION_HOST_TARGET_SCHEMA_STATEMENTS = [
  ...SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS,
  ...SESSION_SEARCH_TARGET_SCHEMA_STATEMENTS,
  `
  CREATE INDEX idx_session_nodes_run_created_order
  ON session_nodes (
    session_id,
    json_extract(metadata_json, '$.openWaggle.runId'),
    created_order
  )
  `,
] as const
