import type { AppMigration } from './database-migrations'
import { PI_SESSION_FILE_TAIL_MIGRATION } from './pi-session-file-tail-migration'
import { SESSION_AUTHORITY_REVISION_MIGRATION } from './session-authority-revision-migration'
import { SESSION_NODE_CONTENT_HASH_MIGRATION } from './session-node-content-hash-migration'
import { SESSION_NODE_DUPLICATE_INDEX_MIGRATION } from './session-node-duplicate-index-migration'

/** The v1 performance work's persistence migrations (D6, D7.1, D4), in ledger order (80 onward). */
export const SESSION_PROJECTION_PERFORMANCE_MIGRATIONS: readonly AppMigration[] = [
  SESSION_NODE_CONTENT_HASH_MIGRATION,
  PI_SESSION_FILE_TAIL_MIGRATION,
  SESSION_NODE_DUPLICATE_INDEX_MIGRATION,
  SESSION_AUTHORITY_REVISION_MIGRATION,
]
