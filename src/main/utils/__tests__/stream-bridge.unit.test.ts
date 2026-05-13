import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { broadcastToWindowsMock } = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
}))

vi.mock('../broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

import {
  clearStreamBuffer,
  emitTransportEvent,
  getStreamBuffer,
  startStreamBuffer,
} from '../stream-bridge'

const SESSION_ID = SessionId('session-1')
const OTHER_SESSION_ID = SessionId('session-2')
const MODEL_ID = SupportedModelId('openai/gpt-5.5')
const MESSAGE_ID = MessageId('assistant-1')
const OTHER_MESSAGE_ID = MessageId('assistant-2')
const EVENT_TIMESTAMP = 1

describe('stream-bridge', () => {
  beforeEach(() => {
    clearStreamBuffer(SESSION_ID)
    clearStreamBuffer(OTHER_SESSION_ID)
    broadcastToWindowsMock.mockClear()
  })

  it('keeps the active assistant message id in background run snapshots', () => {
    startStreamBuffer(SESSION_ID, MODEL_ID, 'classic')

    emitTransportEvent(SESSION_ID, {
      type: 'message_start',
      messageId: MESSAGE_ID,
      role: 'assistant',
      timestamp: EVENT_TIMESTAMP,
    })

    expect(getStreamBuffer(SESSION_ID)?.messageId).toBe(MESSAGE_ID)
  })

  it('keeps concurrent active stream buffers isolated by session id', () => {
    startStreamBuffer(SESSION_ID, MODEL_ID, 'classic')
    startStreamBuffer(OTHER_SESSION_ID, MODEL_ID, 'classic')

    emitTransportEvent(SESSION_ID, {
      type: 'message_start',
      messageId: MESSAGE_ID,
      role: 'assistant',
      timestamp: EVENT_TIMESTAMP,
    })
    emitTransportEvent(SESSION_ID, {
      type: 'message_update',
      messageId: MESSAGE_ID,
      role: 'assistant',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Session one output',
      },
      timestamp: EVENT_TIMESTAMP,
    })
    emitTransportEvent(OTHER_SESSION_ID, {
      type: 'message_start',
      messageId: OTHER_MESSAGE_ID,
      role: 'assistant',
      timestamp: EVENT_TIMESTAMP,
    })
    emitTransportEvent(OTHER_SESSION_ID, {
      type: 'message_update',
      messageId: OTHER_MESSAGE_ID,
      role: 'assistant',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Session two output',
      },
      timestamp: EVENT_TIMESTAMP,
    })

    expect(getStreamBuffer(SESSION_ID)).toEqual(
      expect.objectContaining({
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        parts: [{ type: 'text', text: 'Session one output' }],
      }),
    )
    expect(getStreamBuffer(OTHER_SESSION_ID)).toEqual(
      expect.objectContaining({
        sessionId: OTHER_SESSION_ID,
        messageId: OTHER_MESSAGE_ID,
        parts: [{ type: 'text', text: 'Session two output' }],
      }),
    )
  })
})
