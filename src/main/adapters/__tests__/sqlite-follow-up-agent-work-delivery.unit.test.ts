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
 * Agents' work counts wherever it runs, and a running queue delivers in order, so the person's
 * Follow-up never waits behind an agent's (ADR 0030, amended 2026-11-10).
 */
describe('Queue delivery of agents’ work beside the person’s', () => {
  beforeEach(async () => {
    resetFollowUpEditRequests()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-agent-work-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  // A running queue delivers in order: holding the agent's head back would hold the person's.
  it('starts an agent’s Follow-up its withdraw delivers when the person’s waits behind it', async () => {
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
      followUpId: 'agent-next',
    })
    expect(result.after.followUpQueue).toMatchObject({ state: 'running', items: [{ id: 'mine' }] })
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
})
