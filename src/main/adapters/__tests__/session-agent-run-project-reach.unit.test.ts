import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requestedWaggleRunId } from '../../domain/session-control/root-session-project-reach'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { runInputWidensReach } from '../session-agent-run-input-reach'
import { sessionAgentRunReachesEveryProject } from '../session-agent-run-project-reach'

const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'
const DEEPER_THAN_THE_CHAIN_LIMIT = 10

interface RootSession {
  readonly id: string
  readonly origin: string
  /** Who started its Run `run-<id>`. */
  readonly initiator: string
  /** Who wrote the Run's input when someone else re-authorized it. */
  readonly author?: string
  readonly parent?: string
}

interface QueuedFollowUp {
  readonly id: string
  readonly sessionId: string
  readonly callerId: string
  readonly authorCallerId?: string
}

describe('sessionAgentRunReachesEveryProject', () => {
  let root = ''
  let databaseCount = 0

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-project-reach-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function withCatalog<A>(
    sessions: readonly RootSession[],
    followUps: readonly QueuedFollowUp[],
    use: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>,
  ) {
    databaseCount += 1
    const database = SqliteClient.layer({
      filename: path.join(root, `catalog-${databaseCount}.sqlite`),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(
          `CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL DEFAULT 0)`,
        )
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL, authority_scope_snapshot_json TEXT
        )`)
        yield* sql.unsafe(`CREATE TABLE session_spawn_lineage (
          child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL
        )`)
        yield* sql.unsafe(
          'CREATE TABLE session_lineage (session_id TEXT PRIMARY KEY, parent_session_id TEXT)',
        )
        yield* sql.unsafe(`CREATE TABLE session_follow_ups (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT NOT NULL
        )`)
        for (const followUp of followUps) {
          yield* sql`INSERT INTO session_follow_ups (id, session_id, intent_json) VALUES (
            ${followUp.id}, ${followUp.sessionId}, ${JSON.stringify({
              callerId: followUp.callerId,
              ...(followUp.authorCallerId ? { authorCallerId: followUp.authorCallerId } : {}),
            })}
          )`
        }
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql`INSERT INTO session_client_profiles (id, scope_json, revoked_at) VALUES
          (${'project'}, ${'{"projectPaths":["/a"]}'}, ${null}),
          (${'catalog'}, ${'{"all":true}'}, ${null})`
        for (const session of sessions) {
          yield* sql`INSERT INTO session_runs (id, session_id, intent_json) VALUES (
            ${`run-${session.id}`}, ${session.id}, ${JSON.stringify({
              callerId: session.initiator,
              ...(session.author ? { authorCallerId: session.author } : {}),
            })}
          )`
          yield* sql`INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id
          ) VALUES (${session.id}, ${PROFILE_JSON}, ${session.origin})`
          if (session.parent) {
            yield* sql`INSERT INTO session_spawn_lineage (child_session_id, parent_session_id)
              VALUES (${session.id}, ${session.parent})`
          }
        }
        return yield* use(sql)
      }).pipe(Effect.provide(database)),
    )
  }

  function reaches(sessions: readonly RootSession[], sessionId: string) {
    return withCatalog(sessions, [], (sql) =>
      sessionAgentRunReachesEveryProject(sql, sessionId, `run-${sessionId}`),
    )
  }

  it('reaches every project when the desktop user or a catalog-wide profile started the Run', async () => {
    await expect(
      reaches([{ id: 's', origin: 'gui:local-user', initiator: 'gui:local-user' }], 's'),
    ).resolves.toBe(true)
    await expect(
      reaches([{ id: 's', origin: 'gui:local-user', initiator: 'profile:catalog' }], 's'),
    ).resolves.toBe(true)
  })

  it('stays in its project when a project-scoped profile or MCP caller started the Run', async () => {
    await expect(
      reaches([{ id: 's', origin: 'gui:local-user', initiator: 'profile:project' }], 's'),
    ).resolves.toBe(false)
    await expect(
      reaches([{ id: 's', origin: 'gui:local-user', initiator: 'transient-mcp:a' }], 's'),
    ).resolves.toBe(false)
  })

  it('follows a chain of agents back to whoever started the first Run', async () => {
    const byDesktop = [
      { id: 'first', origin: 'gui:local-user', initiator: 'gui:local-user' },
      { id: 's', origin: 'gui:local-user', initiator: 'session-agent:first:run-first' },
    ]
    const byProfile = [
      { id: 'first', origin: 'gui:local-user', initiator: 'profile:project' },
      { id: 's', origin: 'gui:local-user', initiator: 'session-agent:first:run-first' },
    ]
    await expect(reaches(byDesktop, 's')).resolves.toBe(true)
    await expect(reaches(byProfile, 's')).resolves.toBe(false)
  })

  it('does not let a Worker-started Run of its Queen reach every project', async () => {
    const sessions = [
      { id: 'queen', origin: 'gui:local-user', initiator: 'session-agent:worker:run-worker' },
      {
        id: 'worker',
        origin: 'gui:local-user',
        initiator: 'session-agent:queen:run-queen',
        parent: 'queen',
      },
    ]
    await expect(reaches(sessions, 'queen')).resolves.toBe(false)
  })

  it('refuses a chain longer than eight agents and a Run it cannot find', async () => {
    const chain = Array.from({ length: DEEPER_THAN_THE_CHAIN_LIMIT }, (_, index) => ({
      id: `s${index}`,
      origin: 'gui:local-user',
      initiator: index === 0 ? 'gui:local-user' : `session-agent:s${index - 1}:run-s${index - 1}`,
    }))
    // s8 is eight agents from the desktop user's Run; s9 is nine.
    await expect(reaches(chain, 's8')).resolves.toBe(true)
    await expect(reaches(chain, 's9')).resolves.toBe(false)
    await expect(reaches([], 'missing')).resolves.toBe(false)
  })

  it('judges an agent-requested Waggle by the classic Run that requested it', async () => {
    const byDesktop = [{ id: 's', origin: 'gui:local-user', initiator: 'gui:local-user' }]
    const byProfile = [{ id: 's', origin: 'gui:local-user', initiator: 'profile:project' }]
    await expect(
      withCatalog(byDesktop, [], (sql) =>
        sessionAgentRunReachesEveryProject(sql, 's', requestedWaggleRunId('run-s')),
      ),
    ).resolves.toBe(true)
    await expect(
      withCatalog(byProfile, [], (sql) =>
        sessionAgentRunReachesEveryProject(sql, 's', requestedWaggleRunId('run-s')),
      ),
    ).resolves.toBe(false)
  })

  it('needs the author of a re-authorized Follow-up to reach every project too', async () => {
    const laundered = [
      {
        id: 's',
        origin: 'gui:local-user',
        initiator: 'gui:local-user',
        author: 'profile:project',
      },
    ]
    await expect(reaches(laundered, 's')).resolves.toBe(false)
  })
})

describe('runInputWidensReach', () => {
  let root = ''
  let databaseCount = 0

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-input-reach-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const desktopRun = [{ id: 's', origin: 'gui:local-user', initiator: 'gui:local-user' }]

  function widens(
    sessions: readonly RootSession[],
    input: { readonly callerId: string; readonly followUpId?: string },
    followUps: readonly QueuedFollowUp[] = [],
  ) {
    databaseCount += 1
    const database = SqliteClient.layer({
      filename: path.join(root, `input-${databaseCount}.sqlite`),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(
          `CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL DEFAULT 0)`,
        )
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL, authority_scope_snapshot_json TEXT
        )`)
        yield* sql.unsafe(
          'CREATE TABLE session_spawn_lineage (child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL)',
        )
        yield* sql.unsafe(
          'CREATE TABLE session_lineage (session_id TEXT PRIMARY KEY, parent_session_id TEXT)',
        )
        yield* sql.unsafe(
          'CREATE TABLE session_client_profiles (id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, revoked_at INTEGER)',
        )
        yield* sql.unsafe(
          'CREATE TABLE session_follow_ups (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT NOT NULL)',
        )
        yield* sql`INSERT INTO session_client_profiles (id, scope_json, revoked_at) VALUES
          (${'project'}, ${'{"projectPaths":["/a"]}'}, ${null}),
          (${'catalog'}, ${'{"all":true}'}, ${null})`
        for (const session of sessions) {
          yield* sql`INSERT INTO session_runs (id, session_id, intent_json) VALUES (
            ${`run-${session.id}`}, ${session.id}, ${JSON.stringify({ callerId: session.initiator })}
          )`
          yield* sql`INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id
          ) VALUES (${session.id}, ${PROFILE_JSON}, ${session.origin})`
        }
        for (const followUp of followUps) {
          yield* sql`INSERT INTO session_follow_ups (id, session_id, intent_json) VALUES (
            ${followUp.id}, ${followUp.sessionId}, ${JSON.stringify({ callerId: followUp.callerId })}
          )`
        }
        return yield* runInputWidensReach(sql, { ...input, sessionId: 's', runId: 'run-s' })
      }).pipe(Effect.provide(database)),
    )
  }

  it('refuses input from a project-scoped caller into a Run that reaches every project', async () => {
    await expect(widens(desktopRun, { callerId: 'profile:project' })).resolves.toBe(true)
    await expect(widens(desktopRun, { callerId: 'transient-mcp:a' })).resolves.toBe(true)
  })

  it('accepts input from the desktop user or a catalog-wide caller', async () => {
    await expect(widens(desktopRun, { callerId: 'gui:local-user' })).resolves.toBe(false)
    await expect(widens(desktopRun, { callerId: 'profile:catalog' })).resolves.toBe(false)
  })

  it('accepts any caller into a Run that stays in its project', async () => {
    const projectRun = [{ id: 's', origin: 'gui:local-user', initiator: 'profile:project' }]
    await expect(widens(projectRun, { callerId: 'profile:project' })).resolves.toBe(false)
  })

  it('judges a promoted Follow-up by its author as well as by the promoter', async () => {
    const followUps = [{ id: 'f', sessionId: 's', callerId: 'profile:project' }]
    await expect(
      widens(desktopRun, { callerId: 'gui:local-user', followUpId: 'f' }, followUps),
    ).resolves.toBe(true)
  })
})
