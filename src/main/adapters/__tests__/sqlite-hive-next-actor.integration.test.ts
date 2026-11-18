import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeHiveNextActorHost,
  openHiveNextActorHost,
  readDelegation,
  runWorker,
  setParentQueue,
  startWorker,
  WORKER,
  withHost,
} from './sqlite-hive-next-actor.test-support'

describe('Hive next actor: a failed Run (#380)', () => {
  beforeEach(openHiveNextActorHost)
  afterEach(closeHiveNextActorHost)
  it('records a failed Run in the history and routes it by the parent’s activity, after a restart too', async () => {
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    const afterFailure = await withHost(readDelegation)
    expect(afterFailure).toEqual({
      state: 'needs_attention',
      cause: 'run_failed',
      transitions: ['working>needs_attention:session-host'],
      // The Queen is idle with nothing queued: no agent will pick the Worker up.
      next: { nextActor: 'user', reason: 'stuck' },
    })

    const withActiveQueen = await withHost((sql) =>
      setParentQueue(sql, { activeRun: true, queue: 'running', items: 0 }).pipe(
        Effect.zipRight(readDelegation(sql)),
      ),
    )
    expect(withActiveQueen.next).toEqual({ nextActor: 'parent', reason: 'run-failed' })
  })

  it('derives "no agent will pick it up" live from the parent’s Run and queue', async () => {
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    const nextFor = (input: Parameters<typeof setParentQueue>[1]) =>
      withHost((sql) =>
        setParentQueue(sql, input).pipe(
          Effect.zipRight(readDelegation(sql)),
          Effect.map((read) => read.next?.nextActor),
        ),
      )
    expect(await nextFor({ activeRun: false, queue: 'running', items: 0 })).toBe('user')
    expect(await nextFor({ activeRun: false, queue: 'running', items: 1 })).toBe('parent')
    // A paused queue waits on the person.
    expect(await nextFor({ activeRun: false, queue: 'paused', items: 1 })).toBe('user')
    expect(await nextFor({ activeRun: true, queue: 'paused', items: 0 })).toBe('parent')
  })

  it('clears a failed Run when a new Run starts from any source, and keeps it cleared after a restart', async () => {
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    // The person types in the Worker: not the parent, still a new Run.
    const activation = await withHost(() => startWorker('local-user', 'retry'))
    expect(activation).toMatchObject({
      accepted: true,
      attentionCleared: {
        delegationId: 'delegation-worker',
        parentSessionId: SessionId('queen'),
        workerSessionId: WORKER,
        state: 'working',
      },
    })
    expect(await withHost(readDelegation)).toEqual({
      state: 'working',
      cause: null,
      transitions: ['working>needs_attention:session-host', 'needs_attention>working:session-host'],
      next: { nextActor: 'worker', reason: 'working' },
    })
  })

  it('returns a Worker that failed while revising to revising', async () => {
    await withHost(
      (sql) =>
        sql`UPDATE delegation_contracts SET state = ${'revision_requested'} WHERE id = ${'delegation-worker'}`,
    )
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    await withHost(() => startWorker('local-user', 'retry'))
    const read = await withHost(readDelegation)
    expect(read).toMatchObject({ state: 'revision_requested', cause: null })
    expect(read.next).toEqual({ nextActor: 'worker', reason: 'revising' })
  })
})
