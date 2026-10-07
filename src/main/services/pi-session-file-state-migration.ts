import type { AppMigration } from './database-migrations'
import { PI_SESSION_FILE_STATE_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Persists the Pi file state each Session's projection was read from (ADR 0048), so a Host
 * restart can tell in one `stat` whether a file changed outside OpenWaggle instead of parsing
 * every file again, and records the working directory a discovered Pi session ran in. Additive
 * only: nothing existing is changed.
 */
export const PI_SESSION_FILE_STATE_MIGRATION = {
  id: PI_SESSION_FILE_STATE_MIGRATION_ID,
  name: 'pi-session-file-state',
  statements: [
    `CREATE TABLE IF NOT EXISTS pi_session_file_projections (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      file_size INTEGER,
      file_mtime_ms REAL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `ALTER TABLE pi_session_adoptions ADD COLUMN cwd TEXT`,
  ],
} satisfies AppMigration
