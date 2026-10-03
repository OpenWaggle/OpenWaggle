import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promoteSessionFollowUp } from '../../../application/session-control-promotion-service'
import { readQueue } from '../../sqlite-session-query-details'
import {
  directSteer,
  envelope,
  liveSession,
  makeRuntime,
  RUN_ID,
  SESSION_ID,
  settle,
  startRunWithFollowUps,
} from './session-control-undelivered-steering.test-support'

describe('Undelivered steering messages through Session Control and Pi run control', () => {
  let temporaryRoot = ''
  let unregister: (() => void) | undefined

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-undelivered-flow-'))
  })

  afterEach(async () => {
    unregister?.()
    unregister = undefined
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns a direct steer and a pending promotion to the front of the queue on Stop', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'stop.sqlite'))
    const live = liveSession()
    await runtime.runPromise(startRunWithFollowUps())
    unregister = live.register()

    const steered = await runtime.runPromise(directSteer('Also check the rollback.'))
    expect(steered.outcome).toMatchObject({ operation: 'steer', effect: 'steered-run' })
    const promotion = runtime.runPromise(
      promoteSessionFollowUp({
        callerId: 'local-user',
        request: {
          ...envelope('promote'),
          command: {
            operation: 'promote',
            sessionId: SESSION_ID,
            expectedRunId: RUN_ID,
            followUpId: 'follow-up-3',
          },
        },
      }),
    )
    await vi.waitFor(() => expect(live.steer).toHaveBeenCalledTimes(2))
    // Stop: Pi aborts without incorporating either steer and the Run's live control ends.
    unregister()
    unregister = undefined
    await expect(promotion).resolves.toMatchObject({ outcome: { effect: 'rejected' } })

    const result = await runtime.runPromise(settle('interrupted'))
    const listed = await runtime.runPromise(
      SqlClient.SqlClient.pipe(
        Effect.flatMap((sql) =>
          readQueue(sql, {
            contractVersion: SESSION_QUERY_CONTRACT_VERSION,
            requestId: 'request-queue',
            query: { operation: 'queue-list', sessionId: SESSION_ID },
          }),
        ),
      ),
    )
    await runtime.dispose()

    expect(result.settlement).toMatchObject({ accepted: true })
    expect(result.state).toEqual({ queue_state: 'paused', pause: 'run-interrupted' })
    expect(result.queue).toEqual([
      {
        id: 'follow-up-4',
        text: 'Also check the rollback.',
        attachmentIds: [],
        callerId: 'session-agent:queen',
        acceptedAt: 1234,
        idempotencyKey: 'idempotency-direct-steer',
        returnedSteer: { runId: RUN_ID },
      },
      expect.objectContaining({ id: 'follow-up-3', text: 'Promoted while running.' }),
      expect.objectContaining({ id: 'follow-up-2', text: 'Queued first.' }),
    ])
    // The steer's caller can recognise it in the queue instead of sending it again.
    expect(listed.outcome).toMatchObject({
      operation: 'queue-list',
      items: [
        {
          followUpId: 'follow-up-4',
          returnedSteer: { runId: RUN_ID, idempotencyKey: 'idempotency-direct-steer' },
        },
        { followUpId: 'follow-up-3' },
        { followUpId: 'follow-up-2' },
      ],
    })
    if (listed.outcome.operation === 'queue-list' && 'items' in listed.outcome) {
      expect(listed.outcome.items[1]).not.toHaveProperty('returnedSteer')
    }
  })

  it('returns nothing when Pi incorporated the steer before the Run completed', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'completed.sqlite'))
    const live = liveSession()
    await runtime.runPromise(startRunWithFollowUps())
    unregister = live.register()

    await runtime.runPromise(directSteer('Also check the rollback.'))
    live.incorporate('Also check the rollback.')
    unregister()
    unregister = undefined

    const result = await runtime.runPromise(settle('completed'))
    await runtime.dispose()

    expect(result.settlement).toMatchObject({
      accepted: true,
      scheduled: { followUpId: 'follow-up-2' },
    })
    expect(result.queue.map((item) => item.id)).toEqual(['follow-up-3'])
  })
})
