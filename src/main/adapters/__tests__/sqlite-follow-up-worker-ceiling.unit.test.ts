import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editSessionFollowUp } from '../../application/session-control-queue-edit-service'
import { mutateSessionQueue } from '../../application/session-control-service'
import {
  closedWindowFollowUpEditHoldKey,
  expiredFollowUpEditHoldKey,
} from '../../domain/session-control/follow-up-edit-hold-release-key'
import {
  beginEdit,
  followUpEditLayer,
  HOLD,
  idleQueue,
  loadState,
  request,
  resetFollowUpEditRequests,
  SESSION,
  USER,
} from './sqlite-follow-up-edit-hold.test-support'
import { AGENT, busyRoot, busyWorkerHive } from './sqlite-follow-up-worker-ceiling.test-support'

let tmpRoot = ''

function layer(name: string) {
  return followUpEditLayer(tmpRoot, name)
}

/*
 * The Active Workers ceiling holds back only what agents start (ADR 0030, amended 2026-11-09).
 * The person's own queue action delivers its Run whatever the limits, even an agent's Follow-up.
 */
describe('Queue delivery and the Worker ceiling', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-ceiling-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('starts the person’s edited Follow-up however many root Runs are active', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'held' }])
        const begun = yield* beginEdit('held')
        if (begun.outcome.effect !== 'follow-up-edit-held') throw new Error('expected a hold')
        yield* busyRoot
        const saved = yield* editSessionFollowUp({
          callerId: USER,
          desktopUser: true,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-edit-save',
            sessionId: SESSION,
            followUpId: 'held',
            holdId: HOLD,
            expectedQueueRevision: begun.outcome.queueRevision,
            input: { text: 'Edited while busy', attachmentIds: [] },
          }),
        })
        return { saved, after: yield* loadState() }
      }).pipe(Effect.provide(layer('person-edit-busy.sqlite'))),
    )

    expect(result.saved.outcome).toMatchObject({
      operation: 'queue-edit-save',
      effect: 'started-run',
      followUpId: 'held',
    })
    expect(result.after.run).toMatchObject({
      state: 'starting',
      intent: { text: 'Edited while busy' },
    })
  })

  it('starts the agent’s next Follow-up the person’s withdraw delivers at the Worker ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'mine' }, { id: 'agent-next' }])
        yield* busyWorkerHive
        const withdrawn = yield* mutateSessionQueue({
          callerId: USER,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-withdraw',
            sessionId: SESSION,
            followUpIds: ['mine'],
          }),
        })
        return { withdrawn, after: yield* loadState() }
      }).pipe(Effect.provide(layer('person-withdraw.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'started-run',
      followUpId: 'agent-next',
    })
    expect(result.after.run).toMatchObject({ state: 'starting' })
  })

  it('starts the agent’s Follow-up when the person resumes a Worker’s queue at the ceiling', async () => {
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
      }).pipe(Effect.provide(layer('person-resume.sqlite'))),
    )

    expect(result.resumed.outcome).toMatchObject({
      operation: 'queue-resume',
      effect: 'started-run',
      followUpId: 'agent-next',
    })
    expect(result.after.run).toMatchObject({ state: 'starting' })
  })

  it('refuses an agent’s resume of a Worker’s queue at the Worker ceiling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* idleQueue([{ id: 'agent-next' }], 'paused')
        yield* busyWorkerHive
        const before = yield* loadState()
        const resumed = yield* mutateSessionQueue({
          callerId: AGENT,
          hostRunCeiling: 1,
          request: request({
            operation: 'queue-resume',
            sessionId: SESSION,
            expectedQueueRevision: before.followUpQueue.revision,
          }),
        })
        return { resumed, after: yield* loadState() }
      }).pipe(Effect.provide(layer('agent-resume.sqlite'))),
    )

    expect(result.resumed.outcome).toMatchObject({
      operation: 'queue-resume',
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
    expect(result.after.followUpQueue).toMatchObject({ state: 'paused' })
    expect(result.after.run).toEqual({ state: 'idle' })
  })

  it('pauses the queue when an agent’s withdraw would start a Worker Run at the ceiling', async () => {
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
      }).pipe(Effect.provide(layer('agent-withdraw.sqlite'))),
    )

    expect(result.withdrawn.outcome).toMatchObject({
      operation: 'queue-withdraw',
      effect: 'queue-updated',
      queueState: 'paused',
    })
    // No pause reason: older binaries decode a missing reason, and none names the Host ceiling.
    expect(result.after.followUpQueue).not.toHaveProperty('pauseReason')
    expect(result.after.run).toEqual({ state: 'idle' })
  })

  /*
   * The Host releases a hold the person's window left (expired, or the window gone) with a
   * cancel sent as the person. What it delivers is held to the limits, like an agent's resume.
   */
  it.each([
    ['the person cancels it', 'person-cancel', 'starting'],
    ['it expires', expiredFollowUpEditHoldKey(HOLD), 'idle'],
    ['its window closes', closedWindowFollowUpEditHoldKey(HOLD), 'idle'],
  ])(
    'releases an edit of an agent’s Worker Follow-up at the ceiling when %s',
    async (_, key, run) => {
      const after = await Effect.runPromise(
        Effect.gen(function* () {
          yield* idleQueue([{ id: 'agent-held' }])
          const begun = yield* beginEdit('agent-held')
          if (begun.outcome.effect !== 'follow-up-edit-held') throw new Error('expected a hold')
          yield* busyWorkerHive
          yield* editSessionFollowUp({
            callerId: USER,
            desktopUser: true,
            hostRunCeiling: 1,
            request: {
              ...request({
                operation: 'queue-edit-cancel',
                sessionId: SESSION,
                followUpId: 'agent-held',
                holdId: HOLD,
              }),
              idempotencyKey: key,
            },
          })
          return yield* loadState()
        }).pipe(Effect.provide(layer(`release-${run}-${key.length}.sqlite`))),
      )

      expect(after.run.state).toBe(run)
      if (run === 'idle') expect(after.followUpQueue).toMatchObject({ state: 'paused' })
    },
  )
})
