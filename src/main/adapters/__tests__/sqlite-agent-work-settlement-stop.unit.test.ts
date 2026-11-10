import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { planRunSettlement } from '../sqlite-session-control-run-settlement'
import { AGENT_CALLER } from './sqlite-worker-run-admission.test-support'

const SESSION = SessionId('session-target')

// A stop replaces a wait on agents' capacity, and clients naming the queue revision see it change.
describe('Settlement of a Run whose queue waits on agents’ capacity', () => {
  it('bumps the queue revision when a stop replaces a wait on capacity', () => {
    const settled = planRunSettlement(
      {
        sessionId: SESSION,
        revision: 1,
        run: { state: 'active', runId: RunId('run-mine') },
        followUpQueue: {
          state: 'paused',
          pauseReason: 'parent-limit',
          revision: 4,
          items: [
            {
              id: FollowUpId('agents'),
              deliveryState: 'pending',
              intent: {
                text: 'agents',
                attachmentIds: [],
                callerId: AGENT_CALLER,
                acceptedAt: 1,
                idempotencyKey: 'key-agents',
              },
            },
          ],
        },
      },
      {
        sessionId: SESSION,
        runId: RunId('run-mine'),
        nextRunId: RunId('run-next'),
        terminalStatus: 'interrupted',
        terminalEventAt: 5,
      },
    )

    if (!settled.accepted) throw new Error('settlement refused')
    expect(settled.state.followUpQueue).toMatchObject({
      pauseReason: 'run-interrupted',
      revision: 5,
    })
  })
})
