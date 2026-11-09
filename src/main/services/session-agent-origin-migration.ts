import type { AppMigration } from './database-migrations'
import { SESSION_AGENT_ORIGIN_TABLE_STATEMENT } from './session-host-agent-origin-schema'
import { SESSION_AGENT_ORIGIN_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Records which top-level Sessions an agent made, so the Active Workers ceiling counts their Runs
 * by key instead of scanning the operation history on every admission. The roots an agent, a
 * client profile or a CLI client other than the local user created, launched or forked before
 * are found in that history once, here. A fresh target schema already has the (empty) table.
 */
export const SESSION_AGENT_ORIGIN_MIGRATION = {
  id: SESSION_AGENT_ORIGIN_MIGRATION_ID,
  name: 'session-agent-origins',
  statements: [
    SESSION_AGENT_ORIGIN_TABLE_STATEMENT,
    `INSERT OR IGNORE INTO session_agent_origins (session_id, caller_id, created_at)
      SELECT json_extract(operations.outcome_json, '$.sessionId'), operations.caller_id,
        operations.created_at
      FROM session_operations AS operations
      WHERE operations.operation IN ('create', 'launch', 'fork')
        AND operations.status = 'completed'
        AND json_extract(operations.outcome_json, '$.effect')
          IN ('created-root', 'launched-root', 'forked-session')
        AND json_extract(operations.outcome_json, '$.sessionId') IN (SELECT id FROM sessions)
        AND operations.caller_id NOT IN ('local-user', 'gui:local-user')
        AND substr(operations.caller_id, 1, 11) <> 'local-user:'`,
  ],
} satisfies AppMigration
