import type { AppMigration } from './database-migrations'
import { PI_SESSION_FILE_TAIL_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Records where the entries each Session's projection was read from end in its Pi file, next to
 * the file's size and modification time (D6): the byte offset after the last projected entry, where
 * that entry's line starts, a digest of the file's first bytes and of that line, its entry id, how
 * many entries were projected, and the leaf the projection was taken at. A Run then projects only
 * the entries Pi appended after it, and a refresh reads only the appended bytes, while the file
 * only grew. Additive: existing rows get no tail, so their next projection reads the whole file.
 */
export const PI_SESSION_FILE_TAIL_MIGRATION = {
  id: PI_SESSION_FILE_TAIL_MIGRATION_ID,
  name: 'pi-session-file-tail',
  statements: [
    `ALTER TABLE pi_session_file_projections ADD COLUMN tail_offset INTEGER`,
    `ALTER TABLE pi_session_file_projections ADD COLUMN tail_line_start INTEGER`,
    `ALTER TABLE pi_session_file_projections ADD COLUMN tail_digest TEXT`,
    `ALTER TABLE pi_session_file_projections ADD COLUMN tail_entry_id TEXT`,
    `ALTER TABLE pi_session_file_projections ADD COLUMN tail_entry_count INTEGER`,
    `ALTER TABLE pi_session_file_projections ADD COLUMN tail_leaf_node_id TEXT`,
  ],
} satisfies AppMigration
