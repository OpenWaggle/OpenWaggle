import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  startStreamBuffer,
} from '../../utils/stream-buffer'
import { installSessionHostEventRuntime, publishSessionHostEvent } from '../session-host-events'

const SESSION_ID = SessionId('detached-host-session')

describe('Session Host-owned stream projection', () => {
  afterEach(() => clearStreamBuffer(SESSION_ID))

  it('buffers detached Host transport and clears it when the Run settles', () => {
    const eventHub = new SessionHostEventHub()
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: () => undefined,
    })
    const release = installSessionHostEventRuntime({ eventHub, liveness })
    try {
      publishSessionHostEvent({
        kind: 'session-transport',
        sessionId: SESSION_ID,
        event: {
          type: 'agent_start',
          runId: 'run-detached',
          model: 'openai/gpt-5.5',
          timestamp: 1,
        },
      })
      publishSessionHostEvent({
        kind: 'session-transport',
        sessionId: SESSION_ID,
        event: {
          type: 'message_update',
          messageId: 'message-detached',
          role: 'assistant',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'buffered' },
          timestamp: 2,
        },
      })

      expect(getStreamBuffer(SESSION_ID)).toMatchObject({
        messageId: 'message-detached',
        parts: [{ type: 'text', text: 'buffered' }],
      })

      publishSessionHostEvent({
        kind: 'session-state-changed',
        sessionId: SESSION_ID,
        stateRevision: 3,
        operation: 'run-settled',
      })
      expect(getStreamBuffer(SESSION_ID)).toBeNull()
    } finally {
      release()
      eventHub.close()
      liveness.close()
    }
  })

  it('returns an explicit degraded snapshot instead of retaining oversized live content', () => {
    startStreamBuffer(SESSION_ID, SupportedModelId('openai/gpt-5.5'), 'classic')
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'message-large',
      role: 'assistant',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'x'.repeat(MAX_ACTIVE_STREAM_BUFFER_BYTES + 1),
      },
      timestamp: 1,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      parts: [],
      degraded: {
        reason: 'content-limit',
        omittedBytes: MAX_ACTIVE_STREAM_BUFFER_BYTES + 1,
      },
    })
  })
})
