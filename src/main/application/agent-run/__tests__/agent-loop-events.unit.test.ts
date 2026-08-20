import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { isDurableAgentLoopEvent } from '../agent-loop-events'

const sessionId = SessionId('session-agent-loop-events')

describe('isDurableAgentLoopEvent', () => {
  it('keeps warning notifications but drops info notifications and notify acknowledgements', () => {
    expect(
      isDurableAgentLoopEvent({
        type: 'agent_interaction_request',
        timestamp: 10,
        interaction: {
          interactionId: 'info-notify',
          sessionId,
          runId: 'run-agent-loop-notify',
          kind: 'notify',
          source: 'pi-ui',
          createdAt: 10,
          message: 'Extension loaded',
          level: 'info',
        },
      }),
    ).toBe(false)

    expect(
      isDurableAgentLoopEvent({
        type: 'agent_interaction_request',
        timestamp: 12,
        interaction: {
          interactionId: 'warning-notify',
          sessionId,
          runId: 'run-agent-loop-notify',
          kind: 'notify',
          source: 'pi-ui',
          createdAt: 12,
          message: 'Extension needs attention',
          level: 'warning',
        },
      }),
    ).toBe(true)

    expect(
      isDurableAgentLoopEvent({
        type: 'agent_interaction_resolved',
        timestamp: 13,
        runId: 'run-agent-loop-notify',
        interactionId: 'warning-notify',
        kind: 'notify',
        status: 'resolved',
        response: { kind: 'notify', acknowledged: true },
      }),
    ).toBe(false)
  })
})
