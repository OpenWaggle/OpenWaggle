import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mutateSessionQueue } from '../../application/session-control-service'
import {
  beginEdit,
  followUpEditLayer,
  idleQueue,
  loadState,
  request,
  resetFollowUpEditRequests,
  SESSION,
  USER,
} from './sqlite-follow-up-edit-hold.test-support'
import {
  AGENT,
  busyHiveBesidePersonRoot,
  busyWorkerHive,
} from './sqlite-follow-up-worker-ceiling.test-support'

let tmpRoot = ''

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

/*
 * Agents' work counts wherever it runs, and the person's Follow-up never waits behind agents'
 * held back by a limit (ADR 0030, amended 2026-11-10).
 */
describe('Queue delivery of agents’ work beside the person’s', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-agent-work-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  // The person's Follow-up never waits on agents' capacity, and agents' get no slot from it.
  it('starts the person’s Follow-up ahead of the agent’s an agent’s withdraw cannot start', async () => {
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
      }).pipe(Effect.provide(layer('agent-withdraw-person-behind.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'started-run',
      followUpId: 'mine',
    })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'agent-next' }],
    })
  })

  // Agents cannot fan out over the person's Sessions uncounted (ADR 0030, amended 2026-11-10).
  it('pauses the person’s root when an agent’s withdraw would start its Run at the ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-first' }, { id: 'agent-next' }])
        yield* busyHiveBesidePersonRoot
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
      }).pipe(Effect.provide(layer('agent-withdraw-person-root.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      effect: 'queue-updated',
      queueState: 'paused',
    })
    expect(result.after.followUpQueue).toMatchObject({ pauseReason: 'parent-limit' })
    expect(result.after.run).toEqual({ state: 'idle' })
  })

  it('starts the agent’s Follow-up the person resumes in their root at the ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-next' }], 'paused')
        yield* busyHiveBesidePersonRoot
        const before = yield* loadState()
        return yield* mutateSessionQueue({
          callerId: USER,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-resume',
            sessionId: SESSION,
            expectedQueueRevision: before.followUpQueue.revision,
          }),
        })
      }).pipe(Effect.provide(layer('person-resume-root.sqlite'))),
    )

    expect(result.outcome).toMatchObject({ effect: 'started-run', followUpId: 'agent-next' })
  })

  it('starts the person’s Follow-up when an agent’s withdraw changes a queue paused already for capacity', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-first' }, { id: 'agent-next' }, { id: 'mine' }], 'paused')
        yield* busyWorkerHive
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_control_states SET queue_pause_reason = ${'parent-limit'}
          WHERE session_id = ${SESSION}
        `
        return yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['agent-next'],
          }),
        })
      }).pipe(Effect.provide(layer('agent-withdraw-paused-for-capacity.sqlite'))),
    )

    expect(result.outcome).toMatchObject({ effect: 'started-run', followUpId: 'mine' })
  })

  // A failed Run's pause is the person's to lift; a limit holding back an agent's retry only lets
  // the person's own retry go.
  it('keeps a failed Run’s pause when the agent’s deferred retry is refused, and starts the person’s', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue(
          [
            { id: 'earlier', acceptedAt: 1 },
            { id: 'agent-other', acceptedAt: 2 },
            { id: 'agent-retry', acceptedAt: 11 },
            { id: 'mine', acceptedAt: 12 },
          ],
          'paused',
        )
        yield* busyWorkerHive
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_control_states SET queue_pause_reason = ${'run-failed'}
          WHERE session_id = ${SESSION}
        `
        // The failure's explicit retry (accepted after 10) waited behind a hold that has ended.
        yield* sql`
          CREATE TEMP TABLE IF NOT EXISTS session_follow_up_deferred_retries (
            session_id TEXT PRIMARY KEY, accepted_after INTEGER NOT NULL
          )
        `
        yield* sql`
          INSERT INTO temp.session_follow_up_deferred_retries (session_id, accepted_after)
          VALUES (${SESSION}, ${10})
        `
        const withdrawn = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['agent-other'],
          }),
        })
        return { withdrawn, after: yield* loadState() }
      }).pipe(Effect.provide(layer('refused-deferred-retry.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({ effect: 'started-run', followUpId: 'mine' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'run-failed',
      items: [{ id: 'earlier' }, { id: 'agent-retry' }],
    })
  })

  // The deferral outlives a refusal, so the person's retry an edit holds starts once it ends (the
  // Host's lease expiry, not the person's queue action, which would admit the agent's retry).
  it('starts the person’s held retry once the edit ends after the agent’s retry was refused', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue(
          [
            { id: 'earlier', acceptedAt: 1 },
            { id: 'agent-other', acceptedAt: 2 },
            { id: 'agent-more', acceptedAt: 3 },
            { id: 'agent-retry', acceptedAt: 11 },
            { id: 'mine', acceptedAt: 12 },
          ],
          'paused',
        )
        yield* busyWorkerHive
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_control_states SET queue_pause_reason = ${'run-failed'}
          WHERE session_id = ${SESSION}
        `
        yield* sql`
          CREATE TEMP TABLE IF NOT EXISTS session_follow_up_deferred_retries (
            session_id TEXT PRIMARY KEY, accepted_after INTEGER NOT NULL
          )
        `
        yield* sql`
          INSERT INTO temp.session_follow_up_deferred_retries (session_id, accepted_after)
          VALUES (${SESSION}, ${10})
        `
        const held = yield* beginEdit('mine')
        if (held.outcome.effect !== 'follow-up-edit-held') throw new Error('expected a hold')
        yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['agent-other'],
          }),
        })
        const whileHeld = yield* loadState()
        yield* sql`DELETE FROM temp.session_follow_up_edit_holds WHERE follow_up_id = ${'mine'}`
        const after = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['agent-more'],
          }),
        })
        return { whileHeld, after }
      }).pipe(Effect.provide(layer('held-retry-after-refusal.sqlite'))),
    )

    expect(result.whileHeld.followUpQueue).toMatchObject({
      pauseReason: 'run-failed',
      deferredRetryAfter: 10,
    })
    expect(result.after.outcome).toMatchObject({ effect: 'started-run', followUpId: 'mine' })
  })
})
