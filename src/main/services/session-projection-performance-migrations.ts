import type { AppMigration } from './database-migrations'
import { PI_SESSION_FILE_TAIL_MIGRATION } from './pi-session-file-tail-migration'
import { SESSION_NODE_CONTENT_HASH_MIGRATION } from './session-node-content-hash-migration'

/** The v1 performance work's projection migrations (D6), in ledger order (80 onward). */
export const SESSION_PROJECTION_PERFORMANCE_MIGRATIONS: readonly AppMigration[] = [
  SESSION_NODE_CONTENT_HASH_MIGRATION,
  PI_SESSION_FILE_TAIL_MIGRATION,
]
