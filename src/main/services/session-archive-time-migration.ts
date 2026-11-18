import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { AppMigration } from './database-migrations'
import { SESSION_ARCHIVE_TIME_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Archive time (CONTEXT.md) as its own column. Archiving used to leave only `archived = 1` and an
 * `updated_at` it had overwritten, so Settings > Archived items could not tell when an archived
 * session was archived once anything else touched it. Sessions archived before this migration get
 * their `updated_at` as the best record there is.
 *
 * A trigger keeps the column, not each writer: every path that archives or restores a session
 * (the desktop app, the CLI, Hive cleanup) sets `archived` and `updated_at` together, so archiving
 * records that `updated_at` and restoring clears it. Archiving an already archived session keeps
 * its first Archive time. The partial indexes keep the Archived items list and its branch half
 * reading only archived rows.
 */
export const SESSION_ARCHIVE_TIME_MIGRATION = {
  id: SESSION_ARCHIVE_TIME_MIGRATION_ID,
  name: 'session-archive-time',
  statements: [
    `ALTER TABLE sessions ADD COLUMN archived_at INTEGER`,
    `UPDATE sessions SET archived_at = updated_at WHERE archived = 1`,
    `CREATE TRIGGER IF NOT EXISTS session_archive_time AFTER UPDATE OF archived ON sessions
      WHEN new.archived IS NOT old.archived
      BEGIN
        UPDATE sessions
        SET archived_at = CASE WHEN new.archived = 1 THEN new.updated_at ELSE NULL END
        WHERE id = new.id;
      END`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_archived_at
      ON sessions (archived_at DESC, id DESC) WHERE archived = 1`,
  ],
  run: indexArchivedBranches,
} satisfies AppMigration

/**
 * Every app database has `session_branches.archived_at`, but a normalized legacy cutover target
 * can reach this migration without the branch table; it then has no archived branches to index.
 */
function indexArchivedBranches(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const columns = yield* sql<{ readonly name: string }>`
      SELECT name FROM pragma_table_info('session_branches')
    `
    if (!columns.some((column) => column.name === 'archived_at')) return
    yield* sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_session_branches_archived_at
      ON session_branches (archived_at DESC, id DESC) WHERE archived_at IS NOT NULL`)
  })
}
