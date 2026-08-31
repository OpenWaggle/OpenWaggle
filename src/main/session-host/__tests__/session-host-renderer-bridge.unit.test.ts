import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { broadcastToWindowsMock } = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

import { getPhaseForSession, resetPhaseForSession } from '../../agent/phase-tracker'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import {
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBuffers,
  startStreamBuffer,
} from '../../utils/stream-buffer'
import type { LocalSessionHostRuntime } from '../local-session-host-runtime'
import {
  reconcileRemoteRunSnapshots,
  relaySessionHostEvent,
  startSessionHostRendererBridge,
} from '../session-host-renderer-bridge'

const SESSION_ID = SessionId('remote-session')

describe('Session Host renderer bridge', () => {
  beforeEach(() => {
    clearStreamBuffer(SESSION_ID)
    resetPhaseForSession(SESSION_ID)
    broadcastToWindowsMock.mockReset()
  })

  it('projects a remote agent start into background-run state and clears it at settlement', () => {
    relaySessionHostEvent({
      cursor: { hostInstanceId: 'remote-host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-transport',
        sessionId: SESSION_ID,
        event: {
          type: 'agent_start',
          runId: 'remote-run',
          timestamp: 1,
          model: 'openai/gpt-5.5',
        },
      },
    })

    expect(listStreamBuffers()).toEqual([
      expect.objectContaining({
        sessionId: SESSION_ID,
        model: 'openai/gpt-5.5',
        mode: 'classic',
      }),
    ])
    expect(getStreamBuffer(SESSION_ID)).toMatchObject({ parts: [] })

    relaySessionHostEvent({
      cursor: { hostInstanceId: 'remote-host', sequence: 2 },
      timestamp: 2,
      payload: {
        kind: 'session-state-changed',
        sessionId: SESSION_ID,
        stateRevision: 3,
        operation: 'run-settled',
      },
    })

    expect(getStreamBuffer(SESSION_ID)).toBeNull()
    expect(broadcastToWindowsMock).toHaveBeenCalledWith('agent:run-completed', {
      sessionId: SESSION_ID,
    })
  })

  it('seeds an already-active remote Run from the subscription snapshot', () => {
    reconcileRemoteRunSnapshots([
      {
        sessionId: SESSION_ID,
        model: SupportedModelId('openai/gpt-5.5'),
        mode: 'classic',
        startedAt: 10,
        messageId: 'message-live',
        parts: [{ type: 'text', text: 'work already streamed' }],
      },
    ])

    expect(getStreamBuffer(SESSION_ID)).toEqual({
      sessionId: SESSION_ID,
      model: SupportedModelId('openai/gpt-5.5'),
      mode: 'classic',
      startedAt: 10,
      messageId: 'message-live',
      parts: [{ type: 'text', text: 'work already streamed' }],
    })
    expect(broadcastToWindowsMock).toHaveBeenCalledWith('agent:event', {
      sessionId: SESSION_ID,
      event: expect.objectContaining({ type: 'agent_start' }),
    })

    reconcileRemoteRunSnapshots([])
    expect(getStreamBuffer(SESSION_ID)).toBeNull()
    expect(getPhaseForSession(SESSION_ID)).toBeNull()
    expect(broadcastToWindowsMock).toHaveBeenCalledWith('agent:run-completed', {
      sessionId: SESSION_ID,
    })
  })

  it('does not project a locally Host-owned event into the stream buffer twice', () => {
    startStreamBuffer(SESSION_ID, SupportedModelId('openai/gpt-5.5'), 'classic')
    relaySessionHostEvent(
      {
        cursor: { hostInstanceId: 'local-host', sequence: 1 },
        timestamp: 1,
        payload: {
          kind: 'session-transport',
          sessionId: SESSION_ID,
          event: {
            type: 'message_update',
            messageId: 'message-local',
            role: 'assistant',
            assistantMessageEvent: {
              type: 'text_delta',
              contentIndex: 0,
              delta: 'already applied',
            },
            timestamp: 1,
          },
        },
      },
      { streamBufferAlreadyProjected: true },
    )

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({ parts: [] })
    expect(broadcastToWindowsMock).toHaveBeenCalledWith(
      'agent:event',
      expect.objectContaining({ sessionId: SESSION_ID }),
    )
  })

  it('relays remote Waggle lifecycle and attributed transport events to renderer channels', () => {
    const event = {
      type: 'message_start' as const,
      messageId: 'message-1',
      role: 'assistant' as const,
      timestamp: 2,
    }
    const meta = {
      agentIndex: 0,
      agentLabel: 'Reviewer',
      agentColor: 'blue' as const,
      agentModel: SupportedModelId('openai/gpt-5.5'),
      turnNumber: 1,
      collaborationMode: 'sequential' as const,
    }
    relaySessionHostEvent({
      cursor: { hostInstanceId: 'remote-host', sequence: 3 },
      timestamp: 2,
      payload: { kind: 'session-waggle-transport', sessionId: SESSION_ID, event, meta },
    })
    const turnEvent = {
      type: 'collaboration-complete' as const,
      reason: 'Consensus reached',
      totalTurns: 1,
    }
    relaySessionHostEvent({
      cursor: { hostInstanceId: 'remote-host', sequence: 4 },
      timestamp: 3,
      payload: { kind: 'session-waggle-turn', sessionId: SESSION_ID, event: turnEvent },
    })

    expect(broadcastToWindowsMock).toHaveBeenCalledWith('waggle:event', {
      sessionId: SESSION_ID,
      event,
      meta,
    })
    expect(broadcastToWindowsMock).toHaveBeenCalledWith('waggle:turn-event', {
      sessionId: SESSION_ID,
      event: turnEvent,
    })
  })

  it('notifies and resubscribes after an owned bridge slow-consumer resync', async () => {
    const eventHub = new SessionHostEventHub({ subscriberCapacity: 1 })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    const stop = startSessionHostRendererBridge(
      fromPartial<LocalSessionHostRuntime>({ eventHub, liveness }),
    )
    const payload = {
      kind: 'session-state-changed' as const,
      sessionId: SESSION_ID,
      stateRevision: 1,
      operation: 'run-settled',
    }

    eventHub.publish(payload)
    eventHub.publish(payload)
    eventHub.publish(payload)
    await vi.waitFor(() =>
      expect(broadcastToWindowsMock).toHaveBeenCalledWith('session-host:resync-required', {
        reason: 'slow-consumer',
      }),
    )
    expect(eventHub.subscriberCount()).toBe(1)

    eventHub.publish({ ...payload, stateRevision: 2 })
    await vi.waitFor(() =>
      expect(broadcastToWindowsMock).toHaveBeenCalledWith(
        'session-host:event',
        expect.objectContaining({ payload: expect.objectContaining({ stateRevision: 2 }) }),
      ),
    )
    stop()
    liveness.close()
  })
})
