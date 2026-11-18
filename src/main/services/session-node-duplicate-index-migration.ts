import type { AppMigration } from './database-migrations'
import { SESSION_NODE_DUPLICATE_INDEX_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Drops `idx_session_nodes_session_created_order`, which indexes exactly the columns of
 * `idx_session_nodes_session_created_order_unique`, `(session_id, created_order)` (D7.1). Every
 * query ordered or filtered by them uses the unique index; the copy cost ~17 MB on a 300k-node
 * profile and one more B-tree write for every node a snapshot writes.
 */
export const SESSION_NODE_DUPLICATE_INDEX_MIGRATION: AppMigration = {
  id: SESSION_NODE_DUPLICATE_INDEX_MIGRATION_ID,
  name: 'session-node-duplicate-index',
  statements: ['DROP INDEX IF EXISTS idx_session_nodes_session_created_order'],
}
