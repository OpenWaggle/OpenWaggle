import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBuffers,
  startStreamBuffer,
} from '../stream-buffer'

const SESSION_ID = SessionId('session-stream-buffer')
const OTHER_SESSION_ID = SessionId('session-stream-buffer-other')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')
const STARTED_AT = new Date('2026-01-02T03:04:05.000Z')

function clearAllBuffers() {
  for (const buffer of listStreamBuffers()) {
    clearStreamBuffer(buffer.sessionId)
  }
}

describe('stream-buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED_AT)
    clearAllBuffers()
  })

  afterEach(() => {
    clearAllBuffers()
    vi.useRealTimers()
  })

  it('starts, lists, snapshots, and clears background run buffers', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')

    expect(listStreamBuffers()).toEqual([
      { sessionId: SESSION_ID, model: MODEL, mode: 'classic', startedAt: STARTED_AT.getTime() },
    ])
    expect(getStreamBuffer(SESSION_ID)).toEqual({
      sessionId: SESSION_ID,
      model: MODEL,
      mode: 'classic',
      startedAt: STARTED_AT.getTime(),
      parts: [],
    })

    clearStreamBuffer(SESSION_ID)
    expect(getStreamBuffer(SESSION_ID)).toBeNull()
  })

  it('accumulates assistant text, reasoning, tool calls, and tool results from transport events', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'waggle')

    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 1,
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 2,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' },
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 3,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' world' },
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 4,
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: 'reasoning' },
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'src/app.ts' },
      timestamp: 5,
    })
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'src/app.ts' },
      result: 'file contents',
      isError: false,
      timestamp: 6,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      messageId: 'assistant-message-1',
      parts: [
        { type: 'text', text: 'hello world' },
        { type: 'reasoning', text: 'reasoning' },
        {
          type: 'tool-call',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            args: { path: 'src/app.ts' },
            state: 'input-complete',
          },
        },
        {
          type: 'tool-result',
          toolResult: { id: 'tool-1', name: 'read', result: 'file contents', isError: false },
        },
      ],
    })
  })

  it('resets buffered parts when a new assistant message starts', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic')
    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 1,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'old text' },
    })

    applyEventToStreamBuffer(SESSION_ID, {
      type: 'message_start',
      messageId: 'assistant-message-2',
      role: 'assistant',
      timestamp: 2,
    })

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      messageId: 'assistant-message-2',
      parts: [],
    })
  })

  it('ignores events for sessions without an active buffer', () => {
    applyEventToStreamBuffer(OTHER_SESSION_ID, {
      type: 'message_update',
      messageId: 'assistant-message-1',
      role: 'assistant',
      timestamp: 1,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'ignored' },
    })

    expect(getStreamBuffer(OTHER_SESSION_ID)).toBeNull()
  })
})
