import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requestedWaggleRunId } from '../../domain/session-control/root-session-project-reach'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { runInitiatorCeiling, sessionAgentCallerBoundary } from '../session-agent-run-ceiling'

interface RunRow {
  readonly sessionId: string
  readonly runId: string
  readonly callerId: string
  readonly status?: string
  /** The Session's own origin; `profile:<id>` binds it to that profile's live ceiling. */
  readonly origin?: string
  /** Who wrote the Run's input when someone else re-authorized it. */
  readonly author?: string
  /** A Worker of this Session; its grant is revoked when `grantRevoked` is set. */
  readonly parent?: string
  readonly grantRevoked?: boolean
}

describe('runInitiatorCeiling', () => {
  let root = ''
  let databaseCount = 0

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-ceiling-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function withCatalog<A>(
    runs: readonly RunRow[],
    use: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>,
  ) {
    databaseCount += 1
    const database = SqliteClient.layer({
      filename: path.join(root, `ceiling-${databaseCount}.sqlite`),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE session_runs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL,
          intent_json TEXT, created_at INTEGER NOT NULL
        )`)
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL
        )`)
        yield* sql.unsafe(
          'CREATE TABLE session_spawn_lineage (child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL)',
        )
        yield* sql.unsafe(
          'CREATE TABLE session_lineage (session_id TEXT PRIMARY KEY, parent_session_id TEXT)',
        )
        yield* sql.unsafe(`CREATE TABLE derived_child_management_grants (
          child_session_id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql`INSERT INTO session_client_profiles (id, authorization_ceiling, revoked_at) VALUES
          (${'asker'}, ${'ask-for-approval'}, ${null}),
          (${'trusted'}, ${'yolo'}, ${null}),
          (${'revoked'}, ${'yolo'}, ${1})`
        for (const [index, run] of runs.entries()) {
          yield* sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at)
            VALUES (${run.runId}, ${run.sessionId}, ${run.status ?? 'active'},
              ${JSON.stringify({
                callerId: run.callerId,
                ...(run.author ? { authorCallerId: run.author } : {}),
              })}, ${index})`
          if (run.parent) {
            yield* sql`INSERT OR IGNORE INTO session_spawn_lineage (child_session_id, parent_session_id)
              VALUES (${run.sessionId}, ${run.parent})`
            yield* sql`INSERT OR IGNORE INTO derived_child_management_grants (
              child_session_id, authorization_ceiling, revoked_at
            ) VALUES (${run.sessionId}, ${'yolo'}, ${run.grantRevoked ? 1 : null})`
          }
          yield* sql`INSERT OR IGNORE INTO session_execution_profiles (
            session_id, authorization_ceiling, authority_origin_caller_id
          ) VALUES (${run.sessionId}, ${'yolo'}, ${run.origin ?? 'gui:local-user'})`
        }
        return yield* use(sql)
      }).pipe(Effect.provide(database)),
    )
  }

  function ceiling(runs: readonly RunRow[], sessionId: string, runId: string) {
    return withCatalog(runs, (sql) => runInitiatorCeiling(sql, sessionId, runId))
  }

  it('follows the ceiling of the caller that started the Run', async () => {
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'gui:local-user' }], 's', 'r'),
    ).resolves.toBe('yolo')
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'profile:trusted' }], 's', 'r'),
    ).resolves.toBe('yolo')
    // An ask-for-approval profile messaged a yolo Session: its agent must not act as yolo.
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'profile:asker' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
  })

  it('carries an ask-for-approval initiator through a chain of agents', async () => {
    const runs = [
      { sessionId: 'first', runId: 'run-first', callerId: 'profile:asker' },
      { sessionId: 's', runId: 'r', callerId: 'session-agent:first:run-first' },
    ]
    await expect(ceiling(runs, 's', 'r')).resolves.toBe('ask-for-approval')
  })

  it('applies the live ceiling of the profile an initiating agent came from', async () => {
    // Session A came from profile asker (lowered to ask after A was created); the user typed in A.
    const runs = [
      { sessionId: 'a', runId: 'run-a', callerId: 'gui:local-user', origin: 'profile:asker' },
      { sessionId: 'b', runId: 'run-b', callerId: 'session-agent:a:run-a' },
    ]
    await expect(ceiling(runs, 'b', 'run-b')).resolves.toBe('ask-for-approval')
  })

  it('treats a revoked or unknown initiator as ask-for-approval', async () => {
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'profile:revoked' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'transient-mcp:a' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
  })

  it('bounds an agent-requested Waggle by the classic Run that requested it, even later', async () => {
    const classic = { sessionId: 's', runId: 'classic', callerId: 'profile:asker' }
    const waggle = requestedWaggleRunId('classic')
    await expect(ceiling([classic], 's', waggle)).resolves.toBe('ask-for-approval')
    // The classic Run has settled and the Session moved on; the Waggle still acted for asker.
    const later = [
      { ...classic, status: 'completed' },
      { sessionId: 's', runId: 'gui-run', callerId: 'gui:local-user' },
    ]
    await expect(ceiling(later, 's', waggle)).resolves.toBe('ask-for-approval')
  })

  it('treats a Run it cannot find as ask-for-approval', async () => {
    await expect(ceiling([], 's', 'missing')).resolves.toBe('ask-for-approval')
  })

  it('needs the writer of a re-authorized Follow-up to allow yolo as well', async () => {
    const reauthorized = [
      { sessionId: 's', runId: 'r', callerId: 'gui:local-user', author: 'profile:asker' },
    ]
    await expect(ceiling(reauthorized, 's', 'r')).resolves.toBe('ask-for-approval')
  })

  it('treats an initiating Worker with a revoked grant as ask-for-approval', async () => {
    const runs = [
      { sessionId: 'queen', runId: 'run-queen', callerId: 'gui:local-user' },
      {
        sessionId: 'worker',
        runId: 'run-worker',
        callerId: 'session-agent:queen:run-queen',
        parent: 'queen',
        grantRevoked: true,
      },
      { sessionId: 's', runId: 'r', callerId: 'session-agent:worker:run-worker' },
    ]
    await expect(ceiling(runs, 's', 'r')).resolves.toBe('ask-for-approval')
  })

  it('stops following a chain after eight agents', async () => {
    const chain = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `s${index}`,
      runId: `r${index}`,
      callerId: index === 0 ? 'gui:local-user' : `session-agent:s${index - 1}:r${index - 1}`,
    }))
    await expect(ceiling(chain, 's8', 'r8')).resolves.toBe('yolo')
    await expect(ceiling(chain, 's9', 'r9')).resolves.toBe('ask-for-approval')
  })

  it('gives the Runs a Session agent starts the ceiling of the caller it acts for', async () => {
    const runs = [{ sessionId: 's', runId: 'r', callerId: 'profile:asker' }]
    await expect(
      withCatalog(runs, (sql) => sessionAgentCallerBoundary(sql, 'session-agent:s:r')),
    ).resolves.toEqual({ authorizationCeiling: 'ask-for-approval', revoked: false })
    await expect(
      withCatalog([{ sessionId: 's', runId: 'r', callerId: 'gui:local-user' }], (sql) =>
        sessionAgentCallerBoundary(sql, 'session-agent:s:r'),
      ),
    ).resolves.toEqual({ authorizationCeiling: 'yolo', revoked: false })
  })
})
