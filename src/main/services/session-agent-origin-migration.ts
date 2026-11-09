import type { AppMigration } from './database-migrations'
import { SESSION_AGENT_ORIGIN_TABLE_STATEMENT } from './session-host-agent-origin-schema'
import { SESSION_AGENT_ORIGIN_MIGRATION_ID } from './session-host-schema-identity'

function notLocalUser(column: string) {
  return `${column} NOT IN ('local-user', 'gui:local-user') AND substr(${column}, 1, 11) <> 'local-user:'`
}

/**
 * Records what agents made, so the Active Workers ceiling knows it by key (ADR 0030, amended
 * 2026-11-09):
 *
 * - `session_agent_origins`: the top-level Sessions an agent, a client profile or a CLI client
 *   other than the local user created, launched or forked, found in the operation history once
 *   here instead of on every admission, and those a Session agent's Launch schedule launched,
 *   whose launches are journaled as the person it runs as. A fresh target schema already has
 *   the (empty) table.
 * - `scheduled_tasks.work_by_agent`: whether an agent wrote the work a task runs. Before, only
 *   who created a task was known, so that stands for it.
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
        AND ${notLocalUser('operations.caller_id')}`,
    `INSERT OR IGNORE INTO session_agent_origins (session_id, caller_id, created_at)
      SELECT runs.session_id, runs.caller_id, runs.fired_at
      FROM scheduled_task_runs AS runs
      JOIN scheduled_tasks AS tasks ON tasks.id = runs.task_id
      WHERE tasks.kind = 'launch' AND tasks.creator_kind = 'session-agent'
        AND runs.status = 'started'
        AND runs.session_id IN (SELECT id FROM sessions)`,
    'ALTER TABLE scheduled_tasks ADD COLUMN work_by_agent INTEGER NOT NULL DEFAULT 0',
    `UPDATE scheduled_tasks SET work_by_agent = 1 WHERE creator_kind <> 'local-user'`,
  ],
} satisfies AppMigration
