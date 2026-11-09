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

/** The tables the migration reads, with only the columns it uses. */
function legacyDatabase() {
  const database = new Database(':memory:')
  database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
  database.exec(`CREATE TABLE session_operations (
    caller_id TEXT, operation TEXT, idempotency_key TEXT, status TEXT,
    outcome_json TEXT, created_at INTEGER
  )`)
  database.exec('CREATE TABLE scheduled_tasks (id TEXT PRIMARY KEY, kind TEXT, creator_kind TEXT)')
  database.exec(`CREATE TABLE scheduled_task_runs (
    id TEXT PRIMARY KEY, task_id TEXT, status TEXT, caller_id TEXT, session_id TEXT,
    fired_at INTEGER
  )`)
  return database
}

function migrate(database: Database.Database) {
  for (const statement of SESSION_AGENT_ORIGIN_MIGRATION.statements) database.exec(statement)
}

describe('Session agent origin migration', () => {
  it('is the newest migration this binary supports, after 87', () => {
    expect(SESSION_AGENT_ORIGIN_MIGRATION.id).toBe(88)
    expect(APP_MIGRATIONS.at(-1)).toBe(SESSION_AGENT_ORIGIN_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SESSION_AGENT_ORIGIN_MIGRATION.id)
  })

  it('records the roots agents made before, and none the person made', () => {
    const database = legacyDatabase()
    try {
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

      migrate(database)

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

  // A Session agent's Launch schedule runs as the person, so its launches are journaled as theirs.
  it('records the roots a Session agent’s Launch schedule launched, and marks its tasks', () => {
    const database = legacyDatabase()
    try {
      for (const id of ['agent-launched', 'person-launched', 'heartbeat-target']) {
        database.prepare('INSERT INTO sessions (id) VALUES (?)').run(id)
      }
      const task = database.prepare(
        'INSERT INTO scheduled_tasks (id, kind, creator_kind) VALUES (?, ?, ?)',
      )
      task.run('agent-launch', 'launch', 'session-agent')
      task.run('person-launch', 'launch', 'local-user')
      task.run('agent-heartbeat', 'heartbeat', 'session-agent')
      const run = database.prepare(
        `INSERT INTO scheduled_task_runs (id, task_id, status, caller_id, session_id, fired_at)
         VALUES (?, ?, ?, 'local-user', ?, 1)`,
      )
      run.run('r1', 'agent-launch', 'started', 'agent-launched')
      run.run('r2', 'person-launch', 'started', 'person-launched')
      run.run('r3', 'agent-heartbeat', 'started', 'heartbeat-target')
      run.run('r4', 'agent-launch', 'skipped', null)

      migrate(database)

      expect(database.prepare('SELECT session_id FROM session_agent_origins').all()).toEqual([
        { session_id: 'agent-launched' },
      ])
      expect(
        database.prepare('SELECT id, work_by_agent FROM scheduled_tasks ORDER BY id').all(),
      ).toEqual([
        { id: 'agent-heartbeat', work_by_agent: 1 },
        { id: 'agent-launch', work_by_agent: 1 },
        { id: 'person-launch', work_by_agent: 0 },
      ])
    } finally {
      database.close()
    }
  })
})
