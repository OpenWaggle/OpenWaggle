import type { AppMigration } from './database-migrations'
import { PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Records which entry-projection version wrote a Session's projection next to its Pi file tail
 * (D6). A Run keeps the entries before the tail as they are stored, so a fix to how an entry is
 * projected would otherwise never reach the rows already stored. A projection recorded by another
 * version, or before this column existed (null), is not kept: the next one reads every entry.
 * Additive, with no rewrite.
 */
export const PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION = {
  id: PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID,
  name: 'pi-session-file-tail-projection-version',
  statements: [
    `ALTER TABLE pi_session_file_projections ADD COLUMN tail_projection_version INTEGER`,
  ],
} satisfies AppMigration
