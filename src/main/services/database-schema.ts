import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

const DEFAULT_EXTENSION_BUILD_STATUS = OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN

export const CURRENT_SESSION_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    pi_session_id TEXT NOT NULL UNIQUE,
    pi_session_file TEXT,
    project_path TEXT,
    title TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    waggle_config_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_active_node_id TEXT,
    last_active_branch_id TEXT
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
  ON sessions (updated_at DESC)
  `,
  `
  CREATE TABLE IF NOT EXISTS session_nodes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES session_nodes(id) ON DELETE CASCADE,
    pi_entry_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    role TEXT,
    timestamp_ms INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    branch_hint_id TEXT,
    path_depth INTEGER NOT NULL,
    created_order INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_nodes_session_created_order
  ON session_nodes (session_id, created_order ASC)
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_session_nodes_session_created_order_unique
  ON session_nodes (session_id, created_order)
  `,
  `
  CREATE TABLE IF NOT EXISTS session_branches (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_node_id TEXT REFERENCES session_nodes(id),
    head_node_id TEXT REFERENCES session_nodes(id),
    name TEXT NOT NULL,
    is_main INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_branches_session_updated_at
  ON session_branches (session_id, updated_at DESC)
  `,
  `
  CREATE TABLE IF NOT EXISTS session_branch_state (
    branch_id TEXT PRIMARY KEY REFERENCES session_branches(id) ON DELETE CASCADE,
    future_mode TEXT NOT NULL,
    waggle_preset_id TEXT,
    waggle_config_json TEXT,
    last_active_at INTEGER NOT NULL,
    ui_state_json TEXT NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS session_tree_ui_state (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    expanded_node_ids_json TEXT NOT NULL,
    branches_sidebar_collapsed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    expanded_node_ids_touched INTEGER NOT NULL DEFAULT 0
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS session_active_runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL REFERENCES session_branches(id) ON DELETE CASCADE,
    run_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    runtime_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
] as const

export const EXTENSION_LIFECYCLE_SCHEMA_V1_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS extension_lifecycle_state (
    extension_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    trusted INTEGER NOT NULL DEFAULT 0,
    granted_capabilities_json TEXT NOT NULL,
    content_hash TEXT,
    sdk_range TEXT,
    sdk_compatible INTEGER NOT NULL DEFAULT 0,
    diagnostics_json TEXT NOT NULL,
    installed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (extension_id, scope_kind, scope_id)
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_extension_lifecycle_scope
  ON extension_lifecycle_state (scope_kind, scope_id)
  `,
] as const

export const EXTENSION_LIFECYCLE_PACKAGE_VERSION_MIGRATION_STATEMENTS = [
  `
  ALTER TABLE extension_lifecycle_state
  ADD COLUMN package_version TEXT
  `,
] as const

export const EXTENSION_LIFECYCLE_BUILD_APPROVAL_MIGRATION_STATEMENTS = [
  `
  ALTER TABLE extension_lifecycle_state
  ADD COLUMN approved_build_plan_hash TEXT
  `,
] as const

export const EXTENSION_LIFECYCLE_BUILD_RUN_MIGRATION_STATEMENTS = [
  `
  ALTER TABLE extension_lifecycle_state
  ADD COLUMN build_status TEXT NOT NULL DEFAULT '${DEFAULT_EXTENSION_BUILD_STATUS}'
  `,
  `
  ALTER TABLE extension_lifecycle_state
  ADD COLUMN build_log TEXT
  `,
] as const

export const CURRENT_EXTENSION_LIFECYCLE_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS extension_lifecycle_state (
    extension_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    trusted INTEGER NOT NULL DEFAULT 0,
    granted_capabilities_json TEXT NOT NULL,
    content_hash TEXT,
    package_version TEXT,
    approved_build_plan_hash TEXT,
    build_status TEXT NOT NULL DEFAULT '${DEFAULT_EXTENSION_BUILD_STATUS}',
    build_log TEXT,
    sdk_range TEXT,
    sdk_compatible INTEGER NOT NULL DEFAULT 0,
    diagnostics_json TEXT NOT NULL,
    installed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (extension_id, scope_kind, scope_id)
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_extension_lifecycle_scope
  ON extension_lifecycle_state (scope_kind, scope_id)
  `,
] as const

export const CURRENT_EXTENSION_PROJECT_OVERRIDE_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS extension_project_overrides (
    extension_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (extension_id, scope_kind, scope_id, project_path)
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_extension_project_overrides_project
  ON extension_project_overrides (project_path, disabled)
  `,
] as const

export const CURRENT_EXTENSION_SCHEMA_STATEMENTS = [
  ...CURRENT_EXTENSION_LIFECYCLE_SCHEMA_STATEMENTS,
  ...CURRENT_EXTENSION_PROJECT_OVERRIDE_SCHEMA_STATEMENTS,
] as const
