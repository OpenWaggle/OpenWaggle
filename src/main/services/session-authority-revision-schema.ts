/**
 * One durable counter every write that can change a Run's authority bumps, so the Host's authority
 * drift monitor reads a single row instead of rechecking every Run (D4). The triggers cover each
 * table `liveSessionAuthorityBlockReason` reads, limited to the columns it reads, whichever writer
 * makes the change.
 */
export const SESSION_AUTHORITY_REVISION_TABLE = 'session_authority_revision'

const BUMP = `
    INSERT INTO ${SESSION_AUTHORITY_REVISION_TABLE} (singleton, revision) VALUES (1, 1)
    ON CONFLICT(singleton) DO UPDATE SET revision = revision + 1;`

/** [table, the update columns that matter or null for any column]. */
const WATCHED_TABLES = [
  ['session_client_profiles', 'revoked_at'],
  ['derived_child_management_grants', 'revoked_at'],
  ['session_execution_profiles', 'authority_origin_caller_id, authority_scope_snapshot_json'],
  ['session_workspace_bindings', null],
  ['workspace_resources', 'project_path, working_path, lifecycle_state'],
  ['session_spawn_lineage', null],
  ['session_lineage', 'parent_session_id'],
] as const

function triggers(table: string, columns: string | null) {
  const update = columns ? `UPDATE OF ${columns}` : 'UPDATE'
  return [
    `CREATE TRIGGER IF NOT EXISTS ${table}_authority_revision_insert
    AFTER INSERT ON ${table} BEGIN ${BUMP}
    END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_authority_revision_update
    AFTER ${update} ON ${table} BEGIN ${BUMP}
    END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_authority_revision_delete
    AFTER DELETE ON ${table} BEGIN ${BUMP}
    END`,
  ]
}

export const SESSION_AUTHORITY_REVISION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${SESSION_AUTHORITY_REVISION_TABLE} (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
  )`,
  `INSERT OR IGNORE INTO ${SESSION_AUTHORITY_REVISION_TABLE} (singleton, revision) VALUES (1, 0)`,
  ...WATCHED_TABLES.flatMap(([table, columns]) => triggers(table, columns)),
] as const
