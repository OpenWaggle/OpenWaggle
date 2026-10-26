import type { AppMigration } from './database-migrations'
import { DELEGATION_ATTENTION_CAUSE_MIGRATION } from './delegation-attention-cause-migration'
import { HIVE_TOOL_NAME_MIGRATION } from './hive-tool-name-migration'
import { SCHEDULED_TASK_MIGRATION } from './scheduled-task-migration'
import { SESSION_ARCHIVE_TIME_MIGRATION } from './session-archive-time-migration'
import { SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION } from './session-host-deferred-discovery-refresh-migration'
import { SESSION_RESOURCE_DOCS_IMAGE_MIGRATION } from './session-resource-docs-image-migration'

/** The app migrations added during the `1.0.0-beta` train and the release candidates, in ledger order (69 onward). */
export const V1_BETA_MIGRATIONS: readonly AppMigration[] = [
  SESSION_ARCHIVE_TIME_MIGRATION,
  SCHEDULED_TASK_MIGRATION,
  HIVE_TOOL_NAME_MIGRATION,
  SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION,
  SESSION_RESOURCE_DOCS_IMAGE_MIGRATION,
  DELEGATION_ATTENTION_CAUSE_MIGRATION,
]
