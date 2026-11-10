import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scheduledTaskRunKey } from '../../domain/scheduled-tasks/scheduled-task-run-key'
import { hiveWakeKey, isAgentsHiveWakeKey } from '../../domain/session-control/hive-wake'
import { SessionControlRepository } from '../../ports/session-control-repository'
import type { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { wakeCausedOutsideHive } from '../sqlite-hive-wake-work'
import { SqliteSessionControlRepositoryLive } from '../sqlite-session-control-repository'
import { SqliteSessionOrchestrationUpdateRepositoryLive } from '../sqlite-session-orchestration-update-repository'
import { countActiveWorkerRuns } from '../sqlite-worker-run-admission'
import { settleParentRun, submit, WORKER_AGENT } from './sqlite-hive-parent-wake-test-support'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

const FOREIGN_AGENT = 'session-agent:session-foreign:run-foreign'
let root = ''

/** The person's Queen `session-parent` with its Worker `session-worker`, run by the Queen's agent. */
function run<A, E>(
  effect: Effect.Effect<
    A,
    E,
    SqlClient.SqlClient | SessionControlRepository | SessionDelegationRepository
  >,
) {
  const lifecycle = makeSessionLifecycleTestLayer(path.join(root, 'nested-cause.db'))
  const layer = Layer.mergeAll(
    lifecycle,
    SqliteSessionOrchestrationUpdateRepositoryLive.pipe(Layer.provide(lifecycle)),
    SqliteSessionControlRepositoryLive.pipe(Layer.provide(lifecycle)),
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* (yield* SessionLifecycleRepository).execute(spawnLifecycleInput())
      const sql = yield* SqlClient.SqlClient
      yield* settleParentRun(sql, { callerId: 'gui:local-user' })
      yield* setRunIntent(sql, 'run-worker', {
        callerId: 'session-agent:session-parent:run-parent',
      })
      return yield* effect
    }).pipe(Effect.provide(layer)),
  )
}

function setRunIntent(sql: SqlClient.SqlClient, runId: string, intent: object) {
  return sql`UPDATE session_runs SET intent_json = ${JSON.stringify(intent)} WHERE id = ${runId}`
}

function insertSession(sql: SqlClient.SqlClient, id: string) {
  return sql`INSERT INTO sessions (id, pi_session_id, project_path, title, archived, created_at, updated_at)
    VALUES (${id}, ${`pi-${id}`}, ${'/project'}, ${id}, ${0}, ${1}, ${1})`
}

function insertRun(sql: SqlClient.SqlClient, sessionId: string, runId: string, intent: object) {
  return sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${runId}, ${sessionId}, ${'completed'}, ${JSON.stringify(intent)}, ${2}, ${2})`
}

const outside = (parentSessionId: string, triggerCallerIds: readonly string[]) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    wakeCausedOutsideHive(sql, { parentSessionId, triggerCallerIds }),
  )

describe('Whose work a Hive wake is, across nested Queens', () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-wake-nested-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps a nested Queen’s wake, and the top-level wake after it, inside the person’s Hive', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // The Worker spawned its own Worker, in the same Hive under the person's Queen.
        yield* insertSession(sql, 'session-sub')
        yield* sql`INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth, created_at
          ) VALUES (${'session-sub'}, ${'session-worker'}, ${'run-worker'}, ${'session-parent'}, ${2}, ${2})`
        yield* insertRun(sql, 'session-sub', 'run-sub', { callerId: WORKER_AGENT })
        // The nested Queen's wake for its sub-Worker's report, then its reply to the Queen.
        yield* insertRun(sql, 'session-worker', 'run-worker-wake', {
          callerId: 'session-agent:session-parent:run-parent',
          idempotencyKey: hiveWakeKey('session-worker', '1', false),
          hiveWake: true,
        })
        return {
          nested: yield* outside('session-worker', ['session-agent:session-sub:run-sub']),
          top: yield* outside('session-parent', ['session-agent:session-worker:run-worker-wake']),
        }
      }),
    )

    expect(result).toEqual({ nested: false, top: false })
  })

  it('counts a wake whose Worker an agent elsewhere stopped as that agent’s work', async () => {
    // The stopper is the update's cause (`interrupted_by_caller_id`).
    expect(await run(outside('session-parent', [FOREIGN_AGENT]))).toBe(true)
  })

  it('counts a wake that follows a Heartbeat an agent created on the Queen as agents’ work', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // The Queen's Run that started the Worker was an agent-made task firing as the owner.
        yield* setRunIntent(sql, 'run-parent', {
          callerId: 'gui:local-user',
          idempotencyKey: scheduledTaskRunKey('run-task', 'agents'),
        })
        return yield* outside('session-parent', [WORKER_AGENT])
      }),
    )

    expect(result).toBe(true)
  })

  it('stores the mark the start transaction found, so the admitted wake counts', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // After the Host built an unmarked key, an agent elsewhere started the Worker's Run.
        yield* insertSession(sql, 'session-foreign')
        yield* insertRun(sql, 'session-foreign', 'run-foreign', { callerId: 'gui:local-user' })
        yield* setRunIntent(sql, 'run-worker', { callerId: FOREIGN_AGENT })
        yield* submit(3000)
        const before = yield* countActiveWorkerRuns(sql)
        const key = hiveWakeKey('session-parent', 'race', false)
        const repository = yield* SessionControlRepository
        const response = yield* repository.executeMutation({
          callerId: 'gui:local-user',
          hostRunCeiling: 16,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: key,
            idempotencyKey: key,
            command: {
              operation: 'start',
              sessionId: 'session-parent',
              input: { text: 'Worker updates arrived.', attachmentIds: [] },
            },
          },
          decide: (state) => ({
            accepted: true,
            state: {
              ...state,
              revision: state.revision + 1,
              run: {
                state: 'starting',
                runId: RunId('run-wake'),
                intent: {
                  text: 'Worker updates arrived.',
                  attachmentIds: [],
                  callerId: 'gui:local-user',
                  acceptedAt: 3100,
                  idempotencyKey: key,
                  hiveWake: true,
                },
              },
            },
            outcome: {
              operation: 'start',
              effect: 'started-run',
              sessionId: SessionId('session-parent'),
              runId: 'run-wake',
              stateRevision: state.revision + 1,
            },
          }),
        })
        const [stored] = yield* sql<{ readonly key: string | null }>`
          SELECT json_extract(intent_json, '$.idempotencyKey') AS key
          FROM session_runs WHERE id = ${'run-wake'}
        `
        return { response, before, after: yield* countActiveWorkerRuns(sql), key: stored?.key }
      }),
    )

    expect(result.response.outcome).toMatchObject({ effect: 'started-run' })
    expect(isAgentsHiveWakeKey(result.key ?? undefined)).toBe(true)
    expect(result.after).toBe(result.before + 1)
  })
})
