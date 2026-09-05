import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  startStreamBuffer,
} from '../stream-buffer'

const SESSION_ID = SessionId('session-stream-buffer-tool-call')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')

afterEach(() => {
  clearStreamBuffer(SESSION_ID)
  vi.restoreAllMocks()
})

function startToolCall() {
  startStreamBuffer(SESSION_ID, MODEL, 'classic')
  applyEventToStreamBuffer(SESSION_ID, {
    type: 'message_update',
    messageId: 'assistant-message-1',
    role: 'assistant',
    timestamp: 0,
    assistantMessageEvent: {
      type: 'toolcall_start',
      contentIndex: 0,
      toolCallId: 'tool-1',
      toolName: 'write',
      input: { content: '' },
    },
  })
}

function appendToolCallDelta(step: number, delta: string, content: string) {
  applyEventToStreamBuffer(SESSION_ID, {
    type: 'message_update',
    messageId: 'assistant-message-1',
    role: 'assistant',
    timestamp: step,
    assistantMessageEvent: {
      type: 'toolcall_delta',
      contentIndex: 0,
      toolCallId: 'tool-1',
      delta,
      input: { content },
    },
  })
}

describe('stream-buffer cumulative tool-call accounting', () => {
  it('retains cumulative arguments', () => {
    startToolCall()
    for (let step = 1; step <= 100; step += 1) {
      appendToolCallDelta(step, 'x'.repeat(1_000), 'x'.repeat(step * 1_000))
    }

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      parts: [{ toolCall: { args: { content: 'x'.repeat(100_000) } } }],
    })
  })

  it('does not serialize cumulative arguments for every delta', () => {
    startToolCall()
    const stringifySpy = vi.spyOn(JSON, 'stringify')
    for (let step = 1; step <= 2_000; step += 1) {
      appendToolCallDelta(step, 'x', 'x'.repeat(step))
    }

    const serializedObjects = stringifySpy.mock.calls.filter(
      ([value]) => typeof value === 'object' && value !== null,
    )
    expect(serializedObjects.length).toBeLessThan(5)
    expect(getStreamBuffer(SESSION_ID)?.parts).toEqual([
      expect.objectContaining({
        toolCall: expect.objectContaining({ args: { content: 'x'.repeat(2_000) } }),
      }),
    ])
  })

  it('counts each omitted delta once after reaching the retained limit', () => {
    startToolCall()
    const oversizedDelta = 'x'.repeat(MAX_ACTIVE_STREAM_BUFFER_BYTES)
    appendToolCallDelta(1, oversizedDelta, oversizedDelta)
    appendToolCallDelta(2, 'y', `${oversizedDelta}y`)

    expect(getStreamBuffer(SESSION_ID)?.degraded?.omittedBytes).toBe(
      Buffer.byteLength(oversizedDelta, 'utf8') + 1,
    )
  })
})
