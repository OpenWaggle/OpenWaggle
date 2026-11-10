import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  candidate,
  runHiveWakeTest,
  settleParentRun,
  submit,
} from './sqlite-hive-parent-wake-test-support'

const AGENT = 'transient-mcp:digest-agent'

/** The person's idle Queen, an agent's Follow-up queued in it, and a Worker that then submits. */
function wakeWithAgentFollowUp(
  root: string,
  queue: { readonly state: string; readonly reason?: string },
) {
  return runHiveWakeTest(
    root,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* settleParentRun(sql, { callerId: 'gui:local-user' })
      yield* sql`
        UPDATE session_control_states
        SET queue_state = ${queue.state}, queue_pause_reason = ${queue.reason ?? null}
        WHERE session_id = ${'session-parent'}
      `
      const intent = {
        text: 'Status?',
        attachmentIds: [],
        callerId: AGENT,
        acceptedAt: 1,
        idempotencyKey: 'agent-status',
      }
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (
          ${'agent-status'}, ${'session-parent'}, ${0}, ${'pending'}, ${JSON.stringify(intent)},
          ${1}, ${1}
        )
      `
      yield* submit(3000)
      return yield* candidate()
    }),
  )
}

// An agent's Follow-up a Worker limit holds back never stops the Queen acting on its Workers'
// reports; any other queued Follow-up still runs first (ADR 0030, amended 2026-11-10).
describe('Hive wake beside queued Follow-ups', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-wake-queue-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('wakes a parent whose queue waits on agents’ capacity', async () => {
    const woken = await wakeWithAgentFollowUp(root, { state: 'paused', reason: 'parent-limit' })

    expect(woken).toMatchObject({ parentSessionId: 'session-parent', callerId: 'gui:local-user' })
  })

  it.each([
    ['a running queue', { state: 'running' }],
    ['a queue the person paused', { state: 'paused', reason: 'requested' }],
  ])('leaves %s to deliver first', async (_, queue) => {
    expect(await wakeWithAgentFollowUp(root, queue)).toBeUndefined()
  })
})
