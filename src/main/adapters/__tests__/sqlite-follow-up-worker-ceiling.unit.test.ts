import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mutateSessionQueue } from '../../application/session-control-service'
import { ensureFollowUpEditHoldTable } from '../sqlite-follow-up-edit-holds'
import {
  followUpEditLayer,
  idleQueue,
  loadState,
  request,
  resetFollowUpEditRequests,
  SESSION,
  USER,
} from './sqlite-follow-up-edit-hold.test-support'
import { AGENT, busyWorkerHive } from './sqlite-follow-up-worker-ceiling.test-support'
import { adopt } from './sqlite-session-control-follow-up-adopt.test-support'

let tmpRoot = ''

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

/* Queue delivery in a Worker at a full Worker ceiling (ADR 0030, amended 2026-11-09). */
describe('Follow-up delivery at the Worker ceiling', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-ceiling-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('pauses a Worker’s agent Follow-up that an agent’s queue change would start at the ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-first' }, { id: 'agent-next' }])
        yield* busyWorkerHive
        const withdrawn = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['agent-first'],
          }),
        })
        return { withdrawn, after: yield* loadState() }
      }).pipe(Effect.provide(layer('worker-ceiling-pause.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'queue-updated',
      queueState: 'paused',
      withdrawnFollowUpIds: ['agent-first'],
    })
    // Both Worker limits pause as `parent-limit`, which every binary decodes.
    expect(result.after.followUpQueue).toMatchObject({ pauseReason: 'parent-limit' })
    expect(result.after.followUpQueue.items).toMatchObject([{ id: 'agent-next' }])
    expect(result.after.run).toEqual({ state: 'idle' })
  })

  it('delivers an agent’s head at the ceiling when the person’s Follow-up waits behind it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-first' }, { id: 'agent-next' }, { id: 'mine' }])
        yield* busyWorkerHive
        const withdrawn = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['agent-first'],
          }),
        })
        return { withdrawn, after: yield* loadState() }
      }).pipe(Effect.provide(layer('worker-ceiling-person-behind.sqlite'))),
    )

    // Holding the agent's head back would hold back the person's message behind it.
    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'started-run',
      followUpId: 'agent-next',
    })
    expect(result.after.followUpQueue.items).toMatchObject([{ id: 'mine' }])
  })

  it('starts a Worker’s agent Follow-up when the person resumes it at the ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-next' }], 'paused')
        yield* busyWorkerHive
        const before = yield* loadState()
        const resumed = yield* mutateSessionQueue({
          callerId: USER,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-resume',
            sessionId: SESSION,
            expectedQueueRevision: before.followUpQueue.revision,
          }),
        })
        return { resumed, after: yield* loadState() }
      }).pipe(Effect.provide(layer('worker-ceiling-resume.sqlite'))),
    )

    // The person's own queue action is never held back by the Worker limits.
    expect(result.resumed.outcome).toMatchObject({
      operation: 'queue-resume',
      effect: 'started-run',
      followUpId: 'agent-next',
    })
    expect(result.after.run).toMatchObject({ state: 'starting' })
  })

  it('holds a failed Run’s agent retry to the ceiling though the person’s Follow-up waits behind it', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // The queue a failed Run left: paused, with an agent's retry sent after the failure.
        yield* idleQueue([{ id: 'mine' }, { id: 'agent-retry', acceptedAt: 300 }], 'paused')
        yield* busyWorkerHive
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_control_states SET queue_pause_reason = ${'run-failed'}
          WHERE session_id = ${SESSION}
        `
        yield* ensureFollowUpEditHoldTable(sql)
        yield* sql`
          INSERT INTO temp.session_follow_up_deferred_retries (session_id, accepted_after)
          VALUES (${SESSION}, ${200})
        `
        const before = yield* loadState()
        const reordered = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-reorder',
            sessionId: SESSION,
            expectedQueueRevision: before.followUpQueue.revision,
            orderedFollowUpIds: ['agent-retry', 'mine'],
          }),
        })
        return { reordered, after: yield* loadState() }
      }).pipe(Effect.provide(layer('failed-retry-paused.sqlite'))),
    )

    // The retry leaves the queue paused, so it does not go on to the person's Follow-up.
    expect(result.reordered.outcome).toMatchObject({
      effect: 'queue-updated',
      queueState: 'paused',
    })
    expect(result.after.run).toEqual({ state: 'idle' })
  })

  it('starts the Follow-up the person sends as their own from a queue parked at the limits', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'follow-up-stuck' }], 'paused')
        yield* busyWorkerHive
        const sql = yield* SqlClient.SqlClient
        // Parked at the limits, then its profile was revoked: the person may send it as theirs.
        yield* sql`
          UPDATE session_follow_ups
          SET delivery_state = ${'needs_attention'}, attention_reason = ${'profile_revoked'}
          WHERE id = ${'follow-up-stuck'}
        `
        yield* sql`
          UPDATE session_control_states SET queue_pause_reason = ${'parent-limit'}
          WHERE session_id = ${SESSION}
        `
        const before = yield* loadState()
        const adopted = yield* adopt({
          key: 'send-as-me',
          desktopUser: true,
          expectedQueueRevision: before.followUpQueue.revision,
        })
        return { adopted, after: yield* loadState() }
      }).pipe(Effect.provide(layer('adopt-parked.sqlite'))),
    )

    expect(result.adopted.outcome).toMatchObject({
      operation: 'queue-adopt',
      effect: 'started-run',
      followUpId: 'follow-up-stuck',
    })
    expect(result.after.run).toMatchObject({ state: 'starting', intent: { callerId: USER } })
  })
})
