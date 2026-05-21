import { CURRENT_SESSION_SCHEMA_STATEMENTS } from './database-schema'

export interface AppMigration {
  readonly id: number
  readonly name: string
  readonly statements: readonly string[]
}

export const APP_MIGRATIONS: readonly AppMigration[] = [
  {
    id: 1,
    name: 'initial-app-persistence',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS settings_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
    ],
  },
  {
    id: 5,
    name: 'pi-session-projection-core',
    statements: [
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
        updated_at INTEGER NOT NULL
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
        updated_at INTEGER NOT NULL
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
    ],
  },
  {
    id: 8,
    name: 'drop-removed-pre-pi-persistence',
    statements: [
      `DROP TABLE IF EXISTS session_message_parts`,
      `DROP TABLE IF EXISTS pinned_context`,
      `DROP TABLE IF EXISTS session_messages`,
      `DROP TABLE IF EXISTS orchestration_run_tasks`,
      `DROP TABLE IF EXISTS orchestration_runs`,
      `DROP TABLE IF EXISTS orchestration_events`,
      `DROP TABLE IF EXISTS provider_session_runtime`,
      `DROP TABLE IF EXISTS team_presets`,
      `DROP TABLE IF EXISTS waggle_presets`,
      `DROP TABLE IF EXISTS team_runtime_state`,
      `DROP TABLE IF EXISTS auth_tokens`,
      `
      DELETE FROM settings_store
      WHERE key IN (
        'providers',
        'executionMode',
        'qualityPreset',
        'mcpServers'
      )
      `,
    ],
  },
  {
    id: 9,
    name: 'session-branch-archive-state',
    statements: [`ALTER TABLE session_branches ADD COLUMN archived_at INTEGER`],
  },
  {
    id: 10,
    name: 'session-tree-expanded-state-touched',
    statements: [
      `ALTER TABLE session_tree_ui_state ADD COLUMN expanded_node_ids_touched INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: 11,
    name: 'normalize-pi-native-session-schema',
    statements: [
      `DROP TABLE IF EXISTS session_active_runs`,
      `DROP TABLE IF EXISTS session_tree_ui_state`,
      `DROP TABLE IF EXISTS session_branch_state`,
      `DROP TABLE IF EXISTS session_branches`,
      `DROP TABLE IF EXISTS session_nodes`,
      `DROP TABLE IF EXISTS sessions`,
      ...CURRENT_SESSION_SCHEMA_STATEMENTS,
    ],
  },
]
