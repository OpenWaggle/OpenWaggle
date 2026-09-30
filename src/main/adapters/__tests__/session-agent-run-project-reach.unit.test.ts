import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { sessionAgentRunReachesEveryProject } from '../session-agent-run-project-reach'

const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'
const DEEPER_THAN_THE_CHAIN_LIMIT = 10

interface RootSession {
  readonly id: string
  readonly origin: string
  /** Who started its Run `run-<id>`. */
  readonly initiator: string
  readonly parent?: string
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

  function reaches(sessions: readonly RootSession[], sessionId: string) {
    databaseCount += 1
    const database = SqliteClient.layer({
      filename: path.join(root, `catalog-${databaseCount}.sqlite`),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(
          'CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT)',
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
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, revoked_at INTEGER
        )`)
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
          if (session.parent) {
            yield* sql`INSERT INTO session_spawn_lineage (child_session_id, parent_session_id)
              VALUES (${session.id}, ${session.parent})`
          }
        }
        return yield* sessionAgentRunReachesEveryProject(sql, sessionId, `run-${sessionId}`)
      }).pipe(Effect.provide(database)),
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

  it('refuses a chain longer than the limit and a Run it cannot find', async () => {
    const chain = Array.from({ length: DEEPER_THAN_THE_CHAIN_LIMIT }, (_, index) => ({
      id: `s${index}`,
      origin: 'gui:local-user',
      initiator: index === 0 ? 'gui:local-user' : `session-agent:s${index - 1}:run-s${index - 1}`,
    }))
    await expect(reaches(chain, `s${DEEPER_THAN_THE_CHAIN_LIMIT - 1}`)).resolves.toBe(false)
    await expect(reaches(chain, 's1')).resolves.toBe(true)
    await expect(reaches([], 'missing')).resolves.toBe(false)
  })
})
