import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startSessionRun } from '../../application/session-control-service'
import { clearWorkerRequestOnParentDelivery } from '../sqlite-delegation-attention'
import {
  closeHiveNextActorHost,
  message,
  openHiveNextActorHost,
  readDelegation,
  setParentQueue,
  setWorkerState,
  startWorker,
  withHost,
} from './sqlite-hive-next-actor.test-support'

describe("Hive next actor: a Worker's request for help (#380)", () => {
  beforeEach(openHiveNextActorHost)
  afterEach(closeHiveNextActorHost)
  it('keeps a Worker’s request for help through Runs nobody from the parent started', async () => {
    await withHost((sql) => setWorkerState(sql, 'needs_attention'))
    expect(await withHost(readDelegation)).toMatchObject({
      state: 'needs_attention',
      cause: 'worker_request',
      next: { nextActor: 'user', reason: 'stuck' },
    })
    const activation = await withHost(() => startWorker('local-user', 'person'))
    expect(activation).not.toHaveProperty('attentionCleared')
    // Another Session's agent is not the parent.
    await withHost(
      (sql) =>
        sql`UPDATE session_control_states SET active_run_id = NULL WHERE session_id = ${'worker'}`,
    )
    const stranger = await withHost(() => message('session-agent:stranger:run-s', 'stranger'))
    expect(stranger.outcome.effect).toBe('started-run')
    const read = await withHost((sql) =>
      setParentQueue(sql, { activeRun: true, queue: 'running', items: 0 }).pipe(
        Effect.zipRight(readDelegation(sql)),
      ),
    )
    expect(read).toMatchObject({ state: 'needs_attention', cause: 'worker_request' })
    expect(read.next).toEqual({ nextActor: 'parent', reason: 'asked-for-help' })
  })

  it('clears a Worker’s request for help when the parent delivers to it, after a restart too', async () => {
    await withHost((sql) => setWorkerState(sql, 'needs_attention'))
    const answer = await withHost(() => message('session-agent:queen:run-q', 'answer'))
    expect(answer.outcome.effect).toBe('started-run')
    expect(await withHost(readDelegation)).toMatchObject({
      state: 'working',
      cause: null,
      transitions: [
        'working>needs_attention:session-agent:worker:run-w',
        'needs_attention>working:session-agent:queen:run-q',
      ],
    })
  })

  it('clears a Worker’s request for help when the parent starts a Run on it', async () => {
    await withHost((sql) => setWorkerState(sql, 'needs_attention'))
    const started = await withHost(() =>
      startSessionRun({
        callerId: 'session-agent:queen:run-q',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-parent-start',
          idempotencyKey: 'parent-start',
          command: {
            operation: 'start',
            sessionId: 'worker',
            input: { text: 'Here are the credentials.', attachmentIds: [] },
          },
        },
      }),
    )
    expect(started.outcome.effect).toBe('started-run')
    expect(await withHost(readDelegation)).toMatchObject({ state: 'working', cause: null })
  })

  it('clears a Worker’s request for help when it sets itself back to working', async () => {
    await withHost((sql) => setWorkerState(sql, 'needs_attention'))
    await withHost((sql) => setWorkerState(sql, 'working'))
    expect(await withHost(readDelegation)).toMatchObject({
      state: 'working',
      cause: null,
      next: { nextActor: 'worker', reason: 'working' },
    })
  })

  it('treats steering, a promotion, a replacement and a start from the parent as delivery, and nothing else', async () => {
    const cleared = await withHost((sql) =>
      Effect.gen(function* () {
        const results: Record<string, boolean> = {}
        const attempts = [
          ['interrupt', 'session-agent:queen:run-q'],
          ['queue-pause', 'session-agent:queen:run-q'],
          ['steer', 'local-user'],
          ['steer', 'session-agent:stranger:run-s'],
          ['steer', 'session-agent:queen:run-q'],
          ['promote', 'session-agent:queen:run-q'],
          ['replace', 'session-agent:queen:run-q'],
          ['start', 'session-agent:queen:run-q'],
        ] as const
        for (const [operation, callerId] of attempts) {
          yield* setWorkerState(sql, 'needs_attention')
          const result = yield* clearWorkerRequestOnParentDelivery(sql, {
            workerSessionId: 'worker',
            callerId,
            operation,
            now: Date.now(),
          })
          results[`${operation} by ${callerId}`] = result !== undefined
        }
        return results
      }),
    )
    expect(cleared).toEqual({
      'interrupt by session-agent:queen:run-q': false,
      'queue-pause by session-agent:queen:run-q': false,
      'steer by local-user': false,
      'steer by session-agent:stranger:run-s': false,
      'steer by session-agent:queen:run-q': true,
      'promote by session-agent:queen:run-q': true,
      'replace by session-agent:queen:run-q': true,
      'start by session-agent:queen:run-q': true,
    })
  })
})
