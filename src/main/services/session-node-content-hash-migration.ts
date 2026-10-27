import type { AppMigration } from './database-migrations'
import { SESSION_NODE_CONTENT_HASH_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Stores a digest of each node's `content_json` and `metadata_json` (D6), so a snapshot compares
 * a Session's nodes by digest and reads back only the content of nodes that changed, instead of
 * selecting every node's content on every Run (38 MB for the largest measured Session).
 *
 * Adding a nullable column is a schema-only change in SQLite: nothing is rewritten, however large
 * the table. Existing rows keep a null digest, which snapshot persistence treats as "compare the
 * content", and fills in for a Session the first time it persists one of its snapshots.
 *
 * The trigger keeps a stored digest honest for any other writer: an update that changes the
 * content or metadata but leaves the digest as it was clears the digest instead.
 */
export const SESSION_NODE_CONTENT_HASH_GUARD_TRIGGER = `
  CREATE TRIGGER IF NOT EXISTS session_nodes_content_hash_guard
  AFTER UPDATE OF content_json, metadata_json ON session_nodes
  WHEN NEW.content_hash IS NOT NULL
    AND NEW.content_hash IS OLD.content_hash
    AND (NEW.content_json IS NOT OLD.content_json OR NEW.metadata_json IS NOT OLD.metadata_json)
  BEGIN
    UPDATE session_nodes SET content_hash = NULL WHERE rowid = NEW.rowid;
  END
`

export const SESSION_NODE_CONTENT_HASH_MIGRATION = {
  id: SESSION_NODE_CONTENT_HASH_MIGRATION_ID,
  name: 'session-node-content-hash',
  statements: [
    `ALTER TABLE session_nodes ADD COLUMN content_hash TEXT`,
    SESSION_NODE_CONTENT_HASH_GUARD_TRIGGER,
  ],
} satisfies AppMigration
