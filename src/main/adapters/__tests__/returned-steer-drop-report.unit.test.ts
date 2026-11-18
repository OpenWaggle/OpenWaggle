import { FollowUpId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { reportDroppedReturnedSteers } from '../returned-steer-drop-report'

const warn = vi.hoisted(() => vi.fn())
vi.mock('../../logger', () => ({ createLogger: () => ({ warn }) }))

describe('reporting dropped returned steers', () => {
  it('logs each dropped steer by what its caller knows it by, never its text', async () => {
    await Effect.runPromise(
      reportDroppedReturnedSteers({ sessionId: 'session-1', runId: 'run-1' }, [
        {
          id: FollowUpId('steer-1'),
          deliveryState: 'pending',
          intent: {
            text: 'Private text',
            attachmentIds: [],
            callerId: 'gui:local-user',
            acceptedAt: 1,
            idempotencyKey: 'key-1',
          },
        },
      ]),
    )
    await Effect.runPromise(reportDroppedReturnedSteers({ sessionId: 's', runId: 'r' }, []))

    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[1]).toEqual({
      sessionId: 'session-1',
      runId: 'run-1',
      droppedCount: 1,
      dropped: [{ followUpId: 'steer-1', callerId: 'gui:local-user', idempotencyKey: 'key-1' }],
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Private text')
  })
})
