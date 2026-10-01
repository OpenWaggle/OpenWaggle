import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBuffers,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  replaceStreamBufferSnapshots,
  startStreamBuffer,
} from '../stream-buffer'

const SESSION_ID = SessionId('session-stream-buffer-user-messages')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')

function clearAllBuffers() {
  for (const buffer of listStreamBuffers()) clearStreamBuffer(buffer.sessionId)
}

function userMessageStart(messageId: string, text: string, order: number): AgentTransportEvent {
  return {
    type: 'message_start',
    messageId,
    role: 'user',
    userMessage: {
      parts: [{ type: 'text', text }],
      sessionNodeCreatedOrder: order,
      durableTextSha256: 'd'.repeat(64),
    },
    timestamp: order,
  }
}

describe('stream-buffer user messages', () => {
  beforeEach(clearAllBuffers)
  afterEach(clearAllBuffers)

  it('keeps the Run user messages reconnectable across assistant messages', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')

    applyEventToStreamBuffer(SESSION_ID, userMessageStart('user-1', 'Queued question', 4))
    applyEventToStreamBuffer(SESSION_ID, userMessageStart('user-1', 'Queued question', 4))
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'assistant-1',
      role: 'assistant',
      timestamp: 5,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      messageId: 'assistant-1',
      userMessages: [
        {
          messageId: 'user-1',
          parts: [{ type: 'text', text: 'Queued question' }],
          sessionNodeCreatedOrder: 4,
          durableTextSha256: 'd'.repeat(64),
        },
      ],
    })
  })

  it('restores retained user messages from a Host snapshot', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    applyEventToStreamBuffer(SESSION_ID, userMessageStart('user-1', 'Steered note', 9))
    const snapshot = getStreamBuffer(SESSION_ID)
    if (!snapshot) throw new Error('Expected an active stream buffer')
    clearAllBuffers()

    replaceStreamBufferSnapshots([snapshot])

    expect(getStreamBuffer(SESSION_ID)?.userMessages).toEqual(snapshot.userMessages)
  })

  it('leaves a user message that exceeds the buffer budget to the persisted snapshot', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')

    applyEventToStreamBuffer(
      SESSION_ID,
      userMessageStart('user-1', 'x'.repeat(MAX_ACTIVE_STREAM_BUFFER_BYTES), 2),
    )

    expect(getStreamBuffer(SESSION_ID)).not.toHaveProperty('userMessages')
  })
})
