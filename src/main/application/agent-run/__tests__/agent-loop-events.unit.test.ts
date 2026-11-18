import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { isDurableAgentLoopEvent } from '../agent-loop-events'

const sessionId = SessionId('session-agent-loop-events')

describe('isDurableAgentLoopEvent', () => {
  // Error is listed because covering only info and warning let a narrowing of the rule to
  // `=== 'warning'` keep the suite green while silently dropping every error from history.
  it.each([
    ['info', false],
    ['warning', true],
    ['error', true],
  ] as const)('keeps a %s notification: %s', (level, durable) => {
    expect(
      isDurableAgentLoopEvent({
        type: 'agent_interaction_request',
        timestamp: 10,
        interaction: {
          interactionId: `${level}-notify`,
          sessionId,
          runId: 'run-agent-loop-notify',
          kind: 'notify',
          source: 'pi-ui',
          createdAt: 10,
          message: 'Extension needs attention',
          level,
        },
      }),
    ).toBe(durable)
  })

  it('drops notify acknowledgements', () => {
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

  it('keeps both halves of a decision, so the row can update in place', () => {
    expect(
      isDurableAgentLoopEvent({
        type: 'agent_interaction_request',
        timestamp: 30,
        interaction: {
          interactionId: 'confirm-1',
          sessionId,
          runId: 'run-agent-loop-confirm',
          kind: 'confirm',
          source: 'pi-ui',
          createdAt: 30,
          title: 'Allow MCP tool call?',
          message: 'Server: github-issues',
          purpose: 'authorization',
        },
      }),
    ).toBe(true)

    expect(
      isDurableAgentLoopEvent({
        type: 'agent_interaction_resolved',
        timestamp: 31,
        runId: 'run-agent-loop-confirm',
        interactionId: 'confirm-1',
        kind: 'confirm',
        status: 'resolved',
        response: { kind: 'confirm', accepted: true },
      }),
    ).toBe(true)
  })
})
