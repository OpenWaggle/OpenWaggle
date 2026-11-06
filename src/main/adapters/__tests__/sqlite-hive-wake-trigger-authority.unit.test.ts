import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  wakeCandidateMayWake,
  workerChangeMayWakeParent,
} from '../sqlite-hive-wake-trigger-authority'
import {
  candidate,
  runHiveWakeTest,
  settleParentRun,
  submit,
  WORKER_AGENT,
} from './sqlite-hive-parent-wake-test-support'

const QUEEN_AGENT = 'session-agent:session-parent:run-parent'

/** The parent's latest Run, started by `callerId`. */
function parentLastRunBy(sql: SqlClient.SqlClient, callerId: string) {
  return sql`
    UPDATE session_runs SET status = ${'completed'}, intent_json = ${JSON.stringify({ callerId })},
      created_at = ${5000}
    WHERE id = ${'run-parent'}
  `
}

function workerRunBy(sql: SqlClient.SqlClient, runId: string, callerId: string) {
  return sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${runId}, ${'session-worker'}, ${'completed'}, ${JSON.stringify({ callerId })},
      ${4000}, ${4000})
  `
}

function mayWake(sql: SqlClient.SqlClient, triggerCallerId: string) {
  return workerChangeMayWakeParent(sql, { parentSessionId: 'session-parent', triggerCallerId })
}

describe('Hive wake trigger authority', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-wake-trigger-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('lets the desktop user’s Hive wake its Queen, but not a CLI profile driving its Worker', async () => {
    const verdicts = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* parentLastRunBy(sql, 'local-user')
        yield* workerRunBy(sql, 'run-from-queen', QUEEN_AGENT)
        yield* workerRunBy(sql, 'run-from-profile', 'profile:other')
        return {
          queenStarted: yield* mayWake(sql, 'session-agent:session-worker:run-from-queen'),
          user: yield* mayWake(sql, 'local-user'),
          // The profile's own submission, and the Worker agent's in a Run the profile started.
          profile: yield* mayWake(sql, 'profile:other'),
          profileStarted: yield* mayWake(sql, 'session-agent:session-worker:run-from-profile'),
        }
      }),
    )

    expect(verdicts).toEqual({
      queenStarted: true,
      user: true,
      profile: false,
      profileStarted: false,
    })
  })

  it('lets a Hive a CLI profile started wake its Queen as that profile', async () => {
    const verdicts = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* parentLastRunBy(sql, 'profile:cli')
        yield* workerRunBy(sql, 'run-from-queen', QUEEN_AGENT)
        yield* workerRunBy(sql, 'run-from-other', 'profile:other')
        return {
          queenStarted: yield* mayWake(sql, 'session-agent:session-worker:run-from-queen'),
          sameProfile: yield* mayWake(sql, 'profile:cli'),
          otherProfile: yield* mayWake(sql, 'session-agent:session-worker:run-from-other'),
        }
      }),
    )

    expect(verdicts).toEqual({ queenStarted: true, sameProfile: true, otherProfile: false })
  })

  it('treats a transient-authority MCP client like a profile', async () => {
    const verdicts = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* parentLastRunBy(sql, 'transient-mcp:digest-1')
        yield* workerRunBy(sql, 'run-from-queen', QUEEN_AGENT)
        return {
          queenStarted: yield* mayWake(sql, 'session-agent:session-worker:run-from-queen'),
          otherClient: yield* mayWake(sql, 'transient-mcp:digest-2'),
        }
      }),
    )

    expect(verdicts).toEqual({ queenStarted: true, otherClient: false })
  })

  it('fails closed on a Run the Host cannot find', async () => {
    const verdict = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* parentLastRunBy(sql, 'local-user')
        return yield* mayWake(sql, 'session-agent:session-worker:run-missing')
      }),
    )

    expect(verdict).toBe(false)
  })

  // However the wake is asked for (the parent's own settlement included, after an update reached
  // its final turn unread), it acts only on updates whose recorded cause may wake the parent.
  it('records who caused each update, and wakes only for a cause that may', async () => {
    const verdicts = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* settleParentRun(sql)
        yield* sql`
          UPDATE session_runs SET intent_json = ${JSON.stringify({ callerId: QUEEN_AGENT })}
          WHERE id = ${'run-worker'}
        `
        yield* submit(6000, 'Overwritten by a client.', 'profile:other')
        const byProfile = yield* candidate()
        if (!byProfile) throw new Error('no candidate')
        const profileMayWake = yield* wakeCandidateMayWake(sql, byProfile)
        yield* sql`UPDATE session_orchestration_updates SET trigger_caller_id = ${WORKER_AGENT}`
        const byWorker = yield* candidate()
        if (!byWorker) throw new Error('no candidate')
        return {
          profileTriggers: byProfile.triggerCallerIds,
          profileMayWake,
          workerMayWake: yield* wakeCandidateMayWake(sql, byWorker),
          // An update recorded before updates named their cause counts as the Host's own.
          legacyMayWake: yield* wakeCandidateMayWake(sql, {
            parentSessionId: 'session-parent',
            triggerCallerIds: [null, 'profile:other'],
          }),
        }
      }),
    )

    expect(verdicts).toEqual({
      profileTriggers: ['profile:other'],
      profileMayWake: false,
      workerMayWake: true,
      legacyMayWake: true,
    })
  })
})
