import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hiveWakeRefusal } from '../sqlite-hive-wake-admission'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { runHiveWakeTest, settleParentRun, submit } from './sqlite-hive-parent-wake-test-support'

/**
 * The in-transaction check of a Hive wake (`hiveWakeRefusal`), as the repository runs it when the
 * Host starts one: the idle parent's Worker has reported, the wake acts for the person who ran
 * the parent last, and that Worker's own active Run fills a Worker ceiling of 1.
 */
function wakeAtFullCeiling(parentIsWorker: boolean) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* settleParentRun(sql, { callerId: 'gui:local-user' })
    yield* submit(3000)
    if (parentIsWorker) {
      // A Worker's admission reads its parent's Worker limit from the app settings.
      yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS settings_store (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      )`)
      yield* sql`INSERT INTO sessions (id, pi_session_id, project_path, title, archived, created_at, updated_at)
        VALUES (${'session-grand'}, ${'pi-grand'}, ${'/project'}, ${'Grand'}, ${0}, ${1}, ${1})`
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${'run-grand'}, ${'session-grand'}, ${'active'}, ${null}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, parent_run_id, hive_root_session_id, depth,
          created_at
        ) VALUES (
          ${'session-parent'}, ${'session-grand'}, ${'run-grand'}, ${'session-grand'}, ${1}, ${1}
        )
      `
    }
    const idle = yield* loadSessionControlState(sql, 'session-parent')
    const waking = {
      ...idle,
      run: {
        state: 'starting' as const,
        runId: RunId('run-wake'),
        intent: {
          text: 'Worker updates arrived while this Session was idle.',
          attachmentIds: [],
          callerId: 'gui:local-user',
          acceptedAt: 3100,
          idempotencyKey: 'hive-wake:session-parent:1',
          hiveWake: true as const,
        },
      },
    }
    return yield* hiveWakeRefusal(sql, waking, 'gui:local-user', 1)
  })
}

describe('Hive wake and the Worker ceiling', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-wake-ceiling-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('wakes a top-level Queen for the person while every Worker slot is taken', async () => {
    expect(await runHiveWakeTest(root, wakeAtFullCeiling(false))).toBeUndefined()
  })

  it('holds a nested Queen’s wake to the Worker ceiling, though it acts for the person', async () => {
    expect(await runHiveWakeTest(root, wakeAtFullCeiling(true))).toBe('host_run_ceiling_reached')
  })
})
