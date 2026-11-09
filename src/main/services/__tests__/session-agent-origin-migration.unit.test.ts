import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { APP_MIGRATIONS } from '../database-migrations'
import { SESSION_AGENT_ORIGIN_MIGRATION } from '../session-agent-origin-migration'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

function recordOperation(
  database: Database.Database,
  callerId: string,
  operation: string,
  outcome: Record<string, string>,
  key: string,
) {
  database
    .prepare(
      `INSERT INTO session_operations (caller_id, operation, idempotency_key, status, outcome_json, created_at)
       VALUES (?, ?, ?, 'completed', ?, 1)`,
    )
    .run(callerId, operation, key, JSON.stringify({ operation, ...outcome }))
}

describe('Session agent origin migration', () => {
  it('is the newest migration this binary supports, after 87', () => {
    expect(SESSION_AGENT_ORIGIN_MIGRATION.id).toBe(88)
    expect(APP_MIGRATIONS.at(-1)).toBe(SESSION_AGENT_ORIGIN_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SESSION_AGENT_ORIGIN_MIGRATION.id)
  })

  it('records the roots agents made before, and none the person made', () => {
    const database = new Database(':memory:')
    try {
      database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
      database.exec(`CREATE TABLE session_operations (
        caller_id TEXT, operation TEXT, idempotency_key TEXT, status TEXT,
        outcome_json TEXT, created_at INTEGER
      )`)
      for (const id of ['agent-launch', 'agent-create', 'profile-fork', 'app', 'cli', 'machine']) {
        database.prepare('INSERT INTO sessions (id) VALUES (?)').run(id)
      }
      const agent = 'session-agent:queen:run-queen'
      recordOperation(
        database,
        agent,
        'launch',
        { effect: 'launched-root', sessionId: 'agent-launch' },
        'a',
      )
      recordOperation(
        database,
        agent,
        'create',
        { effect: 'created-root', sessionId: 'agent-create' },
        'b',
      )
      recordOperation(
        database,
        'profile:ci',
        'fork',
        { effect: 'forked-session', sessionId: 'profile-fork' },
        'c',
      )
      recordOperation(
        database,
        'gui:local-user',
        'create',
        { effect: 'created-root', sessionId: 'app' },
        'd',
      )
      recordOperation(
        database,
        'local-user',
        'launch',
        { effect: 'launched-root', sessionId: 'cli' },
        'e',
      )
      recordOperation(
        database,
        'local-user:host',
        'launch',
        { effect: 'launched-root', sessionId: 'machine' },
        'f',
      )
      // A refused launch made nothing, and a deleted Session has nothing left to record.
      recordOperation(database, agent, 'launch', { effect: 'rejected' }, 'g')
      recordOperation(
        database,
        agent,
        'launch',
        { effect: 'launched-root', sessionId: 'gone' },
        'h',
      )

      for (const statement of SESSION_AGENT_ORIGIN_MIGRATION.statements) database.exec(statement)
      for (const statement of SESSION_AGENT_ORIGIN_MIGRATION.statements) database.exec(statement)

      const rows = database
        .prepare('SELECT session_id, caller_id FROM session_agent_origins ORDER BY session_id')
        .all()
      expect(rows).toEqual([
        { session_id: 'agent-create', caller_id: agent },
        { session_id: 'agent-launch', caller_id: agent },
        { session_id: 'profile-fork', caller_id: 'profile:ci' },
      ])
    } finally {
      database.close()
    }
  })
})
