import type { AppMigration } from './database-migrations'
import { SESSION_NODE_CONTENT_HASH_MIGRATION_ID } from './session-host-schema-identity'
import { SESSION_NODE_CONTENT_HASH_GUARD_TRIGGER } from './session-node-content-hash-schema'

/**
 * Stores a digest of each node's `content_json` and `metadata_json` (D6), so a snapshot compares
 * a Session's nodes by digest and reads back only the content of nodes that changed, instead of
 * selecting every node's content on every Run (38 MB for the largest measured Session).
 *
 * Adding a nullable column is a schema-only change in SQLite: nothing is rewritten, however large
 * the table. Existing rows keep a null digest, which snapshot persistence treats as "compare the
 * content", and fills in for a Session the first time it persists one of its snapshots.
 */
export const SESSION_NODE_CONTENT_HASH_MIGRATION = {
  id: SESSION_NODE_CONTENT_HASH_MIGRATION_ID,
  name: 'session-node-content-hash',
  // A fresh database's current session schema already has the column and the trigger.
  skipIfColumns: { table: 'session_nodes', columns: ['content_hash'] },
  statements: [
    `ALTER TABLE session_nodes ADD COLUMN content_hash TEXT`,
    SESSION_NODE_CONTENT_HASH_GUARD_TRIGGER,
  ],
} satisfies AppMigration
