import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_RUN_INITIATOR_CHAIN_HOPS } from '../../domain/session-control/root-session-project-reach'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { runInitiatorCeiling } from '../../session-host/session-agent-run-ceiling'
import { sessionAgentRunReachesEveryProject } from '../session-agent-run-project-reach'

const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'
/** Twenty round trips of Follow-ups between two roots: far more hops than there are Sessions. */
const ROUND_TRIP_HOPS = 40

/** Runs `run-0` ... `run-<hops>` alternating between roots `a` and `b`, each started by the last. */
function pingPong(hops: number, firstInitiator: string) {
  return Array.from({ length: hops + 1 }, (_, index) => ({
    runId: `run-${index}`,
    sessionId: index % 2 === 0 ? 'a' : 'b',
    callerId:
      index === 0
        ? firstInitiator
        : `session-agent:${(index - 1) % 2 === 0 ? 'a' : 'b'}:run-${index - 1}`,
  }))
}

describe('Run initiator chains between two roots', () => {
  let root = ''
  let databaseCount = 0

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-round-trips-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function withRuns<A>(
    runs: readonly { runId: string; sessionId: string; callerId: string }[],
    use: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>,
  ) {
    databaseCount += 1
    const database = SqliteClient.layer({
      filename: path.join(root, `round-trips-${databaseCount}.sqlite`),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE session_runs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
          intent_json TEXT, created_at INTEGER NOT NULL DEFAULT 0
        )`)
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL, authority_scope_snapshot_json TEXT,
          authorization_ceiling TEXT NOT NULL
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
          id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, authorization_ceiling TEXT NOT NULL,
          revoked_at INTEGER
        )`)
        yield* sql`INSERT INTO session_client_profiles (
          id, scope_json, authorization_ceiling, revoked_at
        ) VALUES (${'asker'}, ${'{"all":true}'}, ${'ask-for-approval'}, ${null})`
        for (const sessionId of ['a', 'b']) {
          yield* sql`INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id, authorization_ceiling
          ) VALUES (${sessionId}, ${PROFILE_JSON}, ${'gui:local-user'}, ${'yolo'})`
        }
        for (const run of runs) {
          yield* sql`INSERT INTO session_runs (id, session_id, intent_json) VALUES (
            ${run.runId}, ${run.sessionId}, ${JSON.stringify({ callerId: run.callerId })}
          )`
        }
        return yield* use(sql)
      }).pipe(Effect.provide(database)),
    )
  }

  function judge(runs: ReturnType<typeof pingPong>) {
    const last = runs[runs.length - 1]
    if (!last) throw new Error('A chain has at least one Run')
    return withRuns(runs, (sql) =>
      Effect.all({
        reach: sessionAgentRunReachesEveryProject(sql, last.sessionId, last.runId),
        ceiling: runInitiatorCeiling(sql, last.sessionId, last.runId),
      }),
    )
  }

  it('keeps reach and ceiling through many round trips of Follow-ups', async () => {
    await expect(judge(pingPong(ROUND_TRIP_HOPS, 'gui:local-user'))).resolves.toEqual({
      reach: true,
      ceiling: 'yolo',
    })
  })

  it('still carries an ask-for-approval first initiator through every round trip', async () => {
    await expect(judge(pingPong(ROUND_TRIP_HOPS, 'profile:asker'))).resolves.toEqual({
      reach: true,
      ceiling: 'ask-for-approval',
    })
  })

  it('fails closed once a chain passes the Run limit', async () => {
    await expect(
      judge(pingPong(MAX_RUN_INITIATOR_CHAIN_HOPS + 1, 'gui:local-user')),
    ).resolves.toEqual({ reach: false, ceiling: 'ask-for-approval' })
    await expect(judge(pingPong(MAX_RUN_INITIATOR_CHAIN_HOPS, 'gui:local-user'))).resolves.toEqual({
      reach: true,
      ceiling: 'yolo',
    })
  })
})
