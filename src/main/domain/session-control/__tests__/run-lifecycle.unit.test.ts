import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  activateStartingRun,
  recoverSessionAfterHostLoss,
  settleAndScheduleNextFollowUp,
  settleSessionRun,
} from '../run-lifecycle'

describe('Session Control Run lifecycle', () => {
  it('activates and settles only the exact starting Run', () => {
    const sessionId = SessionId('session-target')
    const runId = RunId('run-starting')
    const starting = {
      sessionId,
      revision: 2,
      run: {
        state: 'starting' as const,
        runId,
        intent: {
          text: 'Implement it.',
          attachmentIds: [],
          callerId: 'local-user',
          acceptedAt: 1000,
          idempotencyKey: 'start',
        },
      },
      followUpQueue: { state: 'running' as const, revision: 0, items: [] },
    }

    expect(activateStartingRun(starting, RunId('run-stale'))).toMatchObject({
      accepted: false,
      code: 'run_changed',
    })
    const activated = activateStartingRun(starting, runId)
    expect(activated).toMatchObject({
      accepted: true,
      state: { revision: 3, run: { state: 'active', runId } },
    })
    if (!activated.accepted) throw new Error('Expected activation.')
    expect(settleSessionRun(activated.state, runId)).toMatchObject({
      accepted: true,
      state: { revision: 4, run: { state: 'idle' } },
    })
  })

  it('pauses a durable Follow-up queue when recovering a live Run after host loss', () => {
    const recovered = recoverSessionAfterHostLoss({
      sessionId: SessionId('session-target'),
      revision: 6,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: { state: 'running', revision: 4, items: [] },
    })

    expect(recovered).toMatchObject({
      revision: 7,
      run: { state: 'idle' },
      followUpQueue: { state: 'paused', revision: 5 },
    })
  })

  it('atomically promotes the first durable Follow-up when a Run settles', () => {
    const nextRunId = RunId('run-follow-up')
    const result = settleAndScheduleNextFollowUp(
      {
        sessionId: SessionId('session-target'),
        revision: 10,
        run: { state: 'active', runId: RunId('run-active') },
        followUpQueue: {
          state: 'running',
          revision: 3,
          items: [
            {
              id: FollowUpId('follow-up-next'),
              deliveryState: 'pending',
              intent: {
                text: 'Run verification.',
                attachmentIds: [],
                callerId: 'local-user',
                acceptedAt: 1000,
                idempotencyKey: 'follow-up',
              },
            },
          ],
        },
      },
      RunId('run-active'),
      nextRunId,
    )

    expect(result).toMatchObject({
      accepted: true,
      state: {
        revision: 11,
        run: { state: 'starting', runId: nextRunId },
        followUpQueue: { revision: 4, items: [] },
      },
      scheduled: { followUpId: 'follow-up-next', runId: nextRunId },
    })
  })
})
