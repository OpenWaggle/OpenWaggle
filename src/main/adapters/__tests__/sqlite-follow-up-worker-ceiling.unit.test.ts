import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mutateSessionQueue } from '../../application/session-control-service'
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
})
