import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHiveWakeTest } from '../../adapters/__tests__/sqlite-hive-parent-wake-test-support'
import { workerChangeMayWakeParent } from '../hive-wake-trigger-authority'

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
})
