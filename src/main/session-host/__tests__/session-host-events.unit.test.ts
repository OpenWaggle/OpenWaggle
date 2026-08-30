import { describe, expect, it, vi } from 'vitest'
import { isSessionHostEventEnvelope } from '../local-session-event-validation'
import {
  currentSemanticDiscoverySourceRevision,
  publishSessionHostEvent,
  subscribeSemanticDiscoverySourceChangesAfter,
} from '../session-host-events'

describe('Session Host semantic discovery events', () => {
  it('wakes a one-shot source observer only at committed discovery boundaries', () => {
    const wake = vi.fn()
    const revision = currentSemanticDiscoverySourceRevision()
    const release = subscribeSemanticDiscoverySourceChangesAfter(revision, wake)

    publishSessionHostEvent({
      kind: 'session-transport',
      sessionId: 'session-1',
      event: {
        type: 'message_update',
        messageId: 'message-1',
        role: 'assistant',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'partial' },
        timestamp: 1,
      },
    })
    expect(wake).not.toHaveBeenCalled()

    publishSessionHostEvent({
      kind: 'session-transport',
      sessionId: 'session-1',
      event: {
        type: 'message_end',
        messageId: 'message-1',
        role: 'assistant',
        timestamp: 2,
      },
    })
    publishSessionHostEvent({
      kind: 'session-list-changed',
      sessionId: 'session-1',
      change: 'updated',
    })

    expect(wake).toHaveBeenCalledOnce()
    release()
  })

  it('accepts host-wide semantic readiness events without a Session id', () => {
    expect(
      isSessionHostEventEnvelope({
        cursor: { hostInstanceId: 'host-1', sequence: 1 },
        timestamp: 10,
        payload: {
          kind: 'semantic-discovery-readiness-changed',
          readiness: {
            status: 'preparing',
            pendingCount: 2,
            preparationOperationId: 'preparation-1',
          },
        },
      }),
    ).toBe(true)
  })

  it.each([
    {
      kind: 'session-waggle-transport',
      sessionId: 'session-1',
      event: { type: 'agent_start', runId: 'run-1', timestamp: 1 },
      meta: {
        agentIndex: 0,
        agentLabel: 'Worker',
        agentColor: 'blue',
        agentModel: 'provider/model',
        turnNumber: 1,
        collaborationMode: 'sequential',
      },
    },
    {
      kind: 'session-waggle-turn',
      sessionId: 'session-1',
      event: { type: 'collaboration-complete', reason: 'done', totalTurns: 1 },
    },
    {
      kind: 'session-export-changed',
      sessionId: 'session-1',
      exportOperationId: 'export-1',
      status: 'running',
      progress: { recordsWritten: 1, resourcesWritten: 0, bytesWritten: 10 },
    },
  ])('accepts the $kind transport payload', (payload) => {
    expect(
      isSessionHostEventEnvelope({
        cursor: { hostInstanceId: 'host-1', sequence: 2 },
        timestamp: 11,
        payload,
      }),
    ).toBe(true)
  })
})
