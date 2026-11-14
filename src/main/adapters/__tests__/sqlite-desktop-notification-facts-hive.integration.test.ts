import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesktopNotificationFacts } from '../../ports/desktop-notification-facts'
import { SqliteDesktopNotificationFactsLive } from '../sqlite-desktop-notification-facts'
import {
  type HiveWakeTestServices,
  pendingUpdates,
  runHiveWakeTest,
  settleParentRun,
  submit,
} from './sqlite-hive-parent-wake-test-support'

const PARENT = 'session-parent'
const WORKER = 'session-worker'
const GRANDCHILD = 'session-grandchild'

function insertRun(
  sql: SqlClient.SqlClient,
  input: {
    readonly id: string
    readonly sessionId: string
    readonly status: string
    readonly createdAt: number
    readonly updatedAt: number
    readonly hiveWake?: true
    readonly acceptedAt?: number
  },
) {
  const intent = {
    callerId: 'local-user',
    ...(input.hiveWake ? { hiveWake: true } : {}),
    ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
  }
  return sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${input.id}, ${input.sessionId}, ${input.status}, ${JSON.stringify(intent)},
      ${input.createdAt}, ${input.updatedAt})
  `
}

/** A Worker spawned by the Worker: the Hive's second level. */
function insertGrandchild(sql: SqlClient.SqlClient, runStatus: string) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, project_path, title, archived, created_at, updated_at)
      VALUES (${GRANDCHILD}, ${'pi-grandchild'}, ${'/project'}, ${'Grandchild'}, ${1}, ${1}, ${1})
    `
    yield* sql`
      INSERT INTO session_spawn_lineage (
        child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth, created_at
      ) VALUES (${GRANDCHILD}, ${WORKER}, ${'run-worker'}, ${PARENT}, ${2}, ${2100})
    `
    yield* insertRun(sql, {
      id: 'run-grandchild',
      sessionId: GRANDCHILD,
      status: runStatus,
      createdAt: 2100,
      updatedAt: 2100,
    })
  })
}

function settleWorkerRun(sql: SqlClient.SqlClient, at: number) {
  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_runs SET status = ${'completed'}, updated_at = ${at} WHERE id = ${'run-worker'}
    `
    yield* sql`UPDATE session_control_states SET active_run_id = NULL WHERE session_id = ${WORKER}`
  })
}

const facts = Effect.provide(DesktopNotificationFacts, SqliteDesktopNotificationFactsLive)

describe('SqliteDesktopNotificationFactsLive: what still runs in a Hive (ADR 0065)', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-notification-hive-facts-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const run = <A, E>(effect: Effect.Effect<A, E, HiveWakeTestServices>) =>
    runHiveWakeTest(root, effect)

  it('finds the Hive root through every level of spawn lineage', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertGrandchild(sql, 'active')
        const notifications = yield* facts
        return yield* Effect.all([
          notifications.hiveRootSessionId(PARENT),
          notifications.hiveRootSessionId(WORKER),
          notifications.hiveRootSessionId(GRANDCHILD),
          notifications.hiveRootSessionId('missing'),
        ])
      }),
    )
    expect(result).toEqual([PARENT, PARENT, PARENT, 'missing'])
  })

  it('counts the root, its Workers at any depth and archived, and a question asked mid-work', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const notifications = yield* facts
        const delegating = yield* notifications.hiveActivity(PARENT, 'run-parent')
        // The Queen delegated and ended her turn; the Worker still runs.
        yield* settleParentRun(sql)
        const waiting = yield* notifications.hiveActivity(PARENT, 'run-parent')
        // The person asks while the Worker runs.
        yield* insertRun(sql, {
          id: 'run-question',
          sessionId: PARENT,
          status: 'completed',
          createdAt: 2500,
          updatedAt: 2600,
        })
        const question = yield* notifications.hiveActivity(PARENT, 'run-question')
        // The Worker ended; a Worker it spawned (archived) is still stopping.
        yield* settleWorkerRun(sql, 2700)
        yield* insertGrandchild(sql, 'stopping')
        const grandchild = yield* notifications.hiveActivity(PARENT, null)
        // The Worker's own subtree is a Hive below it too.
        const below = yield* notifications.hiveActivity(WORKER, null)
        yield* sql`UPDATE session_runs SET status = ${'completed'} WHERE id = ${'run-grandchild'}`
        const done = yield* notifications.hiveActivity(PARENT, 'run-question')
        return { delegating, waiting, question, grandchild, below, done }
      }),
    )
    const idle = {
      rootRunning: false,
      workersRunning: false,
      wakeComing: false,
      limitedWakeComing: false,
      runStartedWhileWorkersRan: false,
    }
    expect(result).toEqual({
      delegating: { ...idle, rootRunning: true, workersRunning: true },
      // The Worker was spawned during the Queen's Run, so that Run did not start mid-work.
      waiting: { ...idle, workersRunning: true },
      question: { ...idle, workersRunning: true, runStartedWhileWorkersRan: true },
      grandchild: { ...idle, workersRunning: true },
      below: { ...idle, workersRunning: true },
      // The Worker ran when the question started, though it has ended since.
      done: { ...idle, runStartedWhileWorkersRan: true },
    })
  })

  it('judges a queued Follow-up by when the person sent it, not when its Run started', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const notifications = yield* facts
        yield* settleParentRun(sql)
        // Sent at 1000, before the Worker existed (2000); delivered once the Worker ran.
        yield* insertRun(sql, {
          id: 'run-follow-up',
          sessionId: PARENT,
          status: 'completed',
          createdAt: 2500,
          updatedAt: 2600,
          acceptedAt: 1000,
        })
        return yield* notifications.hiveActivity(PARENT, 'run-follow-up')
      }),
    )
    expect(result).toMatchObject({ workersRunning: true, runStartedWhileWorkersRan: false })
  })

  it('sees a Hive wake still coming until a wake Run ends its claim', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const notifications = yield* facts
        yield* settleParentRun(sql)
        yield* submit(3000)
        yield* settleWorkerRun(sql, 3000)
        const reported = yield* notifications.hiveActivity(PARENT, null)
        yield* insertRun(sql, {
          id: 'run-wake',
          sessionId: PARENT,
          status: 'failed',
          createdAt: 3500,
          updatedAt: 3600,
          hiveWake: true,
        })
        const afterWake = yield* notifications.hiveActivity(PARENT, null)
        return { reported, afterWake }
      }),
    )
    // The person's own Queen: a full Active Workers limit would not defer its wake.
    expect(result.reported).toMatchObject({
      workersRunning: false,
      wakeComing: true,
      limitedWakeComing: false,
    })
    expect(result.afterWake).toMatchObject({ workersRunning: false, wakeComing: false })
  })

  it('sees the wake of a root an agent made as one the Worker limits defer', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const notifications = yield* facts
        yield* sql`INSERT INTO session_agent_origins (session_id, caller_id, created_at)
          VALUES (${PARENT}, ${'session-agent:queen:run-1'}, ${1})`
        yield* settleParentRun(sql)
        yield* submit(3000)
        yield* settleWorkerRun(sql, 3000)
        return yield* notifications.hiveActivity(PARENT, null)
      }),
    )
    expect(result).toMatchObject({ wakeComing: true, limitedWakeComing: true })
  })

  it('sees no wake coming for a Queen the person stopped', async () => {
    const stopped = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const notifications = yield* facts
        yield* settleParentRun(sql, { status: 'interrupted' })
        yield* submit(3000)
        yield* settleWorkerRun(sql, 3000)
        return yield* notifications.hiveActivity(PARENT, null)
      }),
    )
    // The person stopped the Queen: no wake overrides that, so nothing is coming.
    expect(stopped).toMatchObject({ rootRunning: false, workersRunning: false, wakeComing: false })
  })

  it('sees no wake coming when the cause of the update may not wake the parent', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const notifications = yield* facts
        yield* settleParentRun(sql)
        // A profile that may only contribute to the Worker submitted its result.
        yield* submit(3000, 'Done.', 'profile:contributor')
        yield* settleWorkerRun(sql, 3000)
        return {
          updates: yield* pendingUpdates(sql),
          activity: yield* notifications.hiveActivity(PARENT, null),
        }
      }),
    )
    // The update waits for the Queen's next Run, so nothing will wake her for it.
    expect(result.updates).toMatchObject([{ status: 'pending', parent_session_id: PARENT }])
    expect(result.activity).toMatchObject({ workersRunning: false, wakeComing: false })
  })
})
