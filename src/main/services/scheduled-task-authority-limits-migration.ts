import type { AppMigration } from './database-migrations'
import { SCHEDULED_TASK_AUTHORITY_LIMITS_MIGRATION_ID } from './session-host-schema-identity'

/**
 * A Scheduled task a Session agent created runs as that agent's owner, within the agent's
 * authority when it created the task (ADR 0058 amendment), so deleting the creating Session no
 * longer stops it. `authority_limits_json` keeps those limits; null means the task holds its
 * owner's whole authority. Tasks created before still name the agent in `creator_caller_id`; the
 * Host adopts them when it next checks them, since that needs the agent's live authority.
 */
export const SCHEDULED_TASK_AUTHORITY_LIMITS_MIGRATION = {
  id: SCHEDULED_TASK_AUTHORITY_LIMITS_MIGRATION_ID,
  name: 'scheduled-task-authority-limits',
  statements: ['ALTER TABLE scheduled_tasks ADD COLUMN authority_limits_json TEXT'],
} satisfies AppMigration
