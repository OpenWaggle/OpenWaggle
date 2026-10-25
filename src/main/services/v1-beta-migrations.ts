import type { AppMigration } from './database-migrations'
import { HIVE_TOOL_NAME_MIGRATION } from './hive-tool-name-migration'
import { SCHEDULED_TASK_MIGRATION } from './scheduled-task-migration'
import { SESSION_ARCHIVE_TIME_MIGRATION } from './session-archive-time-migration'

/** The app migrations added during the `1.0.0-beta` train, in ledger order (69 onward). */
export const V1_BETA_MIGRATIONS: readonly AppMigration[] = [
  SESSION_ARCHIVE_TIME_MIGRATION,
  SCHEDULED_TASK_MIGRATION,
  HIVE_TOOL_NAME_MIGRATION,
]
