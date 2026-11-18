import type { AppMigration } from './database-migrations'
import { HIVE_WAKE_CAUSE_MIGRATION } from './hive-wake-cause-migration'
import { SCHEDULED_TASK_AUTHORITY_LIMITS_MIGRATION } from './scheduled-task-authority-limits-migration'
import { SESSION_AGENT_ORIGIN_MIGRATION } from './session-agent-origin-migration'
import { SESSION_PROJECTION_PERFORMANCE_MIGRATIONS } from './session-projection-performance-migrations'
import { SESSION_RUN_AGENT_WORK_MIGRATION } from './session-run-agent-work-migration'

/**
 * The app migrations from 80 onward, in ledger order: the v1 performance work's, then the ones
 * added after it.
 */
export const V1_RELEASE_MIGRATIONS: readonly AppMigration[] = [
  ...SESSION_PROJECTION_PERFORMANCE_MIGRATIONS,
  SCHEDULED_TASK_AUTHORITY_LIMITS_MIGRATION,
  HIVE_WAKE_CAUSE_MIGRATION,
  SESSION_AGENT_ORIGIN_MIGRATION,
  SESSION_RUN_AGENT_WORK_MIGRATION,
]
