import type { AppMigration } from './database-migrations'
import { SESSION_HOST_QUEUE_PAUSE_REASON_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Records why a Follow-up queue paused (a failed or interrupted Run, a parent concurrency limit,
 * Host loss, a revoked profile, or a caller's request), so the queue can report it. Queues paused
 * before this migration keep a null reason.
 */
export const SESSION_HOST_QUEUE_PAUSE_REASON_MIGRATION = {
  id: SESSION_HOST_QUEUE_PAUSE_REASON_MIGRATION_ID,
  name: 'session-host-queue-pause-reason',
  skipIfColumns: { table: 'session_control_states', columns: ['queue_pause_reason'] },
  statements: [`ALTER TABLE session_control_states ADD COLUMN queue_pause_reason TEXT`],
} satisfies AppMigration
