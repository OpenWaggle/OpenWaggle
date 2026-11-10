import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hiveWakeKey } from '../../domain/session-control/hive-wake'
import { hiveWakeRefusal } from '../sqlite-hive-wake-admission'
import { wakeCausedOutsideHive } from '../sqlite-hive-wake-work'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { countActiveWorkerRuns } from '../sqlite-worker-run-admission'
import {
  candidate,
  runHiveWakeTest,
  settleParentRun,
  submit,
  WORKER_AGENT,
} from './sqlite-hive-parent-wake-test-support'

const FOREIGN_AGENT = 'session-agent:session-foreign:run-foreign'

/**
 * The person's Queen `session-parent` is idle; its Worker reports. `workerRunBy` started the
 * Worker's Run: the Queen's own agent, or an agent in another of the person's Sessions.
 */
function workerReportsAfterRunBy(workerRunBy: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* settleParentRun(sql, { callerId: 'gui:local-user' })
    yield* sql`INSERT INTO sessions (id, pi_session_id, project_path, title, archived, created_at, updated_at)
      VALUES (${'session-foreign'}, ${'pi-foreign'}, ${'/project'}, ${'Foreign'}, ${0}, ${1}, ${1})`
    // The person's own Run in that other Session: its agent acts for the person, elsewhere.
    yield* sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
      VALUES (${'run-foreign'}, ${'session-foreign'}, ${'active'},
        ${JSON.stringify({ callerId: 'gui:local-user' })}, ${1}, ${1})`
    yield* sql`
      UPDATE session_runs
      SET intent_json = json_set(coalesce(intent_json, '{}'), '$.callerId', ${workerRunBy})
      WHERE id = ${'run-worker'}
    `
    yield* submit(3000)
    return sql
  })
}

function wakeAtFullCeiling(workerRunBy: string) {
  return Effect.gen(function* () {
    const sql = yield* workerReportsAfterRunBy(workerRunBy)
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
          idempotencyKey: hiveWakeKey('session-parent', '1', false),
          hiveWake: true as const,
        },
      },
    }
    // The Worker's own active Run fills a Worker ceiling of 1.
    return yield* hiveWakeRefusal(sql, waking, 'gui:local-user', 1)
  })
}

/*
 * A wake is the person's only when the Queen's own Hive caused it. An agent elsewhere that pokes
 * one of its Workers must not get an uncounted, unlimited Queen Run out of it (ADR 0030).
 */
describe('A Hive wake caused from outside the Queen’s Hive', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-wake-outside-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('is held to the Worker ceiling when an agent outside the Hive started the Worker’s Run', async () => {
    expect(await runHiveWakeTest(root, wakeAtFullCeiling(FOREIGN_AGENT))).toBe(
      'host_run_ceiling_reached',
    )
  })

  it('is the person’s when the Queen’s own agent started the Worker’s Run', async () => {
    expect(
      await runHiveWakeTest(root, wakeAtFullCeiling('session-agent:session-parent:run-parent')),
    ).toBeUndefined()
  })

  it('passes an outside cause on through a nested Queen’s marked wake', async () => {
    const outside = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* workerReportsAfterRunBy('session-agent:session-parent:run-parent')
        // The Worker's Run is its own wake, which an agent outside the Hive caused.
        yield* sql`
          UPDATE session_runs SET intent_json = ${JSON.stringify({
            callerId: 'session-agent:session-parent:run-parent',
            idempotencyKey: hiveWakeKey('session-worker', '1', true),
            hiveWake: true,
          })}
          WHERE id = ${'run-worker'}
        `
        return yield* wakeCausedOutsideHive(sql, {
          parentSessionId: 'session-parent',
          triggerCallerIds: [WORKER_AGENT],
        })
      }),
    )

    expect(outside).toBe(true)
  })

  it('marks the candidate, and a running marked wake counts toward the ceiling', async () => {
    const result = await runHiveWakeTest(
      root,
      Effect.gen(function* () {
        const sql = yield* workerReportsAfterRunBy(FOREIGN_AGENT)
        const found = yield* candidate()
        const outside = yield* wakeCausedOutsideHive(sql, {
          parentSessionId: 'session-parent',
          triggerCallerIds: [WORKER_AGENT],
        })
        const before = yield* countActiveWorkerRuns(sql)
        const wake = {
          callerId: 'gui:local-user',
          idempotencyKey: hiveWakeKey('session-parent', '2', true),
          hiveWake: true,
        }
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${'run-wake'}, ${'session-parent'}, ${'active'}, ${JSON.stringify(wake)}, ${4000}, ${4000})
        `
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-wake'}
          WHERE session_id = ${'session-parent'}
        `
        return { found, outside, before, after: yield* countActiveWorkerRuns(sql) }
      }),
    )

    expect(result.outside).toBe(true)
    expect(result.found).toMatchObject({ parentSessionId: 'session-parent' })
    expect(result.after).toBe(result.before + 1)
  })
})
