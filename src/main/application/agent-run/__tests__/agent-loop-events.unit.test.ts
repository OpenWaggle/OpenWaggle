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

describe('isDurableAgentLoopEvent, remaining cases', () => {
  it('keeps an error notification', () => {
    // Previously only info and warning were covered, so narrowing the rule to `=== 'warning'`
    // would have kept the suite green while silently dropping every error from history.
    expect(
      isDurableAgentLoopEvent({
        type: 'agent_interaction_request',
        timestamp: 20,
        interaction: {
          interactionId: 'error-notify',
          sessionId,
          runId: 'run-agent-loop-notify',
          kind: 'notify',
          source: 'pi-ui',
          createdAt: 20,
          message: 'Could not reach api.github.com',
          level: 'error',
        },
      }),
    ).toBe(true)
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
