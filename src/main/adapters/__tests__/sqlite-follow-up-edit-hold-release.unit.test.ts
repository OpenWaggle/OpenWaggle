import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editSessionFollowUp } from '../../application/session-control-queue-edit-service'
import { mutateSessionQueue } from '../../application/session-control-service'
import { loadSessionControlState } from '../sqlite-session-control-state'
import {
  activeRunWithQueuedFollowUp,
  edit,
  FOLLOW_UP,
  followUpEditLayer,
  HOLD,
  request,
  resetFollowUpEditRequests,
  SESSION,
  settleRun,
  USER,
} from './sqlite-follow-up-edit-hold.test-support'

let tmpRoot = ''

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

describe('Follow-up edit holds when the queue cannot deliver', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-edit-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('saves the edit and pauses the queue when the Host cannot admit the next Run', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        yield* edit({ operation: 'queue-edit-begin', sessionId: SESSION, followUpId: FOLLOW_UP })
        yield* settleRun()
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-busy'}, ${'/project'})`
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${'run-busy'}, ${'session-busy'}, ${'active'}, ${null}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (${'session-busy'}, ${1}, ${'run-busy'}, ${'running'}, ${0}, ${1})
        `
        const queued = yield* loadSessionControlState(sql, SESSION)
        const saved = yield* editSessionFollowUp({
          callerId: USER,
          desktopUser: true,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-edit-save',
            sessionId: SESSION,
            followUpId: FOLLOW_UP,
            holdId: HOLD,
            expectedQueueRevision: queued.followUpQueue.revision,
            input: { text: 'Edited while busy', attachmentIds: [] },
          }),
        })
        return { saved, after: yield* loadSessionControlState(sql, SESSION) }
      }).pipe(Effect.provide(layer('ceiling.sqlite'))),
    )

    expect(result.saved.outcome).toMatchObject({
      operation: 'queue-edit-save',
      effect: 'queue-updated',
      queueState: 'paused',
    })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'host-run-ceiling',
      items: [{ id: FOLLOW_UP, intent: { text: 'Edited while busy' } }],
    })
    expect(result.after.followUpQueue.items[0]?.editHold).toBeUndefined()
  })

  it('withdraws a held Follow-up together with its hold', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* activeRunWithQueuedFollowUp
        yield* edit({ operation: 'queue-edit-begin', sessionId: SESSION, followUpId: FOLLOW_UP })
        yield* mutateSessionQueue({
          callerId: USER,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: [FOLLOW_UP],
          }),
        })
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM temp.session_follow_up_edit_holds
        `
      }).pipe(Effect.provide(layer('withdraw.sqlite'))),
    )
    expect(result[0]?.count).toBe(0)
  })
})
