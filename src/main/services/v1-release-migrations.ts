import type { AppMigration } from './database-migrations'
import { SCHEDULED_TASK_AUTHORITY_LIMITS_MIGRATION } from './scheduled-task-authority-limits-migration'
import { SESSION_PROJECTION_PERFORMANCE_MIGRATIONS } from './session-projection-performance-migrations'

/**
 * The app migrations from 80 onward, in ledger order: the v1 performance work's, then the ones
 * added after it.
 */
export const V1_RELEASE_MIGRATIONS: readonly AppMigration[] = [
  ...SESSION_PROJECTION_PERFORMANCE_MIGRATIONS,
  SCHEDULED_TASK_AUTHORITY_LIMITS_MIGRATION,
]
