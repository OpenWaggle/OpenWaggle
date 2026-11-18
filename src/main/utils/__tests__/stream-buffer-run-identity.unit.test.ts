import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBuffers,
  replaceStreamBufferSnapshots,
  startStreamBuffer,
  startStreamBufferFromAgentStart,
} from '../stream-buffer'

const SESSION_ID = SessionId('session-stream-buffer-run-identity')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')

function clearAllBuffers() {
  for (const buffer of listStreamBuffers()) {
    clearStreamBuffer(buffer.sessionId)
  }
}

describe('stream-buffer Run identity', () => {
  beforeEach(clearAllBuffers)
  afterEach(clearAllBuffers)

  it('keeps the Run identity through a Host snapshot so the next Run still starts empty', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'run-1-assistant',
      role: 'assistant',
      timestamp: 1,
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'run-1-assistant',
      role: 'assistant',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'First answer' },
      timestamp: 2,
    })
    const hostSnapshot = getStreamBuffer(SESSION_ID)
    expect(hostSnapshot?.runId).toBe('run-1')
    clearStreamBuffer(SESSION_ID)

    // A reconnect replaces the replica's buffers with the Host's snapshots.
    replaceStreamBufferSnapshots(hostSnapshot ? [hostSnapshot] : [])
    startStreamBufferFromAgentStart(SESSION_ID, {
      type: 'agent_start',
      runId: 'run-2',
      model: MODEL,
      timestamp: 30,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({ runId: 'run-2', parts: [] })
    expect(getStreamBuffer(SESSION_ID)).not.toHaveProperty('messageId')
  })

  it('starts the next Run empty when the Host goes straight on to a queued Follow-up', () => {
    const streamRun = (runId: string, prompt: string, answer: string, order: number) => {
      startStreamBufferFromAgentStart(SESSION_ID, {
        type: 'agent_start',
        runId,
        model: MODEL,
        timestamp: order,
      })
      applyEventToStreamBuffer(SESSION_ID, {
        type: 'message_start',
        messageId: `${runId}-user`,
        role: 'user',
        userMessage: { parts: [{ type: 'text', text: prompt }], sessionNodeCreatedOrder: order },
        timestamp: order,
      })
      applyEventToStreamBuffer(SESSION_ID, {
        type: 'message_start',
        messageId: `${runId}-assistant`,
        role: 'assistant',
        timestamp: order + 1,
      })
      applyEventToStreamBuffer(SESSION_ID, {
        type: 'message_update',
        messageId: `${runId}-assistant`,
        role: 'assistant',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: answer },
        timestamp: order + 2,
      })
    }
    streamRun('run-1', 'First prompt', 'First answer', 10)
    // An auto-retry starts the same Run again and keeps what it streamed.
    startStreamBufferFromAgentStart(SESSION_ID, {
      type: 'agent_start',
      runId: 'run-1',
      model: MODEL,
      timestamp: 20,
    })
    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      messageId: 'run-1-assistant',
      parts: [{ type: 'text', text: 'First answer' }],
    })

    startStreamBufferFromAgentStart(SESSION_ID, {
      type: 'agent_start',
      runId: 'run-2',
      model: MODEL,
      timestamp: 30,
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'run-2-user',
      role: 'user',
      userMessage: {
        parts: [{ type: 'text', text: 'Queued follow-up' }],
        sessionNodeCreatedOrder: 30,
      },
      timestamp: 31,
    })

    const snapshot = getStreamBuffer(SESSION_ID)
    expect(snapshot).toMatchObject({ startedAt: 30, parts: [] })
    expect(snapshot).not.toHaveProperty('messageId')
    expect(snapshot?.userMessages).toEqual([
      {
        messageId: 'run-2-user',
        parts: [{ type: 'text', text: 'Queued follow-up' }],
        sessionNodeCreatedOrder: 30,
        timestamp: 31,
      },
    ])
  })
})
