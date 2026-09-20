import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  MAX_DEGRADED_TOOL_CALL_IDS,
  replaceStreamBufferSnapshots,
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

function appendToolCallDelta(step: number, delta: string, content: string, toolCallId = 'tool-1') {
  applyEventToStreamBuffer(SESSION_ID, {
    type: 'message_update',
    messageId: 'assistant-message-1',
    role: 'assistant',
    timestamp: step,
    assistantMessageEvent: {
      type: 'toolcall_delta',
      contentIndex: 0,
      toolCallId,
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

  it('preserves degraded cumulative arguments across snapshot restoration', () => {
    startToolCall()
    const oversizedDelta = 'x'.repeat(MAX_ACTIVE_STREAM_BUFFER_BYTES)
    appendToolCallDelta(1, oversizedDelta, oversizedDelta)
    const degradedSnapshot = getStreamBuffer(SESSION_ID)
    if (!degradedSnapshot) throw new Error('Expected a degraded stream snapshot.')

    replaceStreamBufferSnapshots([degradedSnapshot])
    appendToolCallDelta(2, 'y', `${oversizedDelta}y`)

    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      parts: [{ toolCall: { args: { content: '' } } }],
      degraded: {
        omittedBytes: Buffer.byteLength(oversizedDelta, 'utf8') + 1,
      },
    })
  })

  it('bounds degraded tool-call ids by count across restoration and live updates', () => {
    const toolCallIds = Array.from(
      { length: MAX_DEGRADED_TOOL_CALL_IDS + 100 },
      (_, index) => `tool-${String(index)}`,
    )
    replaceStreamBufferSnapshots([
      {
        activity: 'agent-run',
        activityEvents: [],
        sessionId: SESSION_ID,
        model: MODEL,
        mode: 'classic',
        startedAt: 0,
        parts: [],
        degraded: { reason: 'content-limit', omittedBytes: 1, toolCallIds },
      },
    ])

    expect(getStreamBuffer(SESSION_ID)?.degraded?.toolCallIds).toEqual(
      toolCallIds.slice(0, MAX_DEGRADED_TOOL_CALL_IDS),
    )

    const oversizedContent = 'x'.repeat(MAX_ACTIVE_STREAM_BUFFER_BYTES)
    appendToolCallDelta(1, oversizedContent, oversizedContent, 'tool-after-limit')

    expect(getStreamBuffer(SESSION_ID)?.degraded?.toolCallIds).toEqual(
      toolCallIds.slice(0, MAX_DEGRADED_TOOL_CALL_IDS),
    )
  })

  it('accounts degraded tool-call ids against the active snapshot byte budget', () => {
    const toolCallIds = Array.from(
      { length: MAX_DEGRADED_TOOL_CALL_IDS },
      (_, index) => `tool-${String(index)}-${'x'.repeat(20 * 1024)}`,
    )
    replaceStreamBufferSnapshots([
      {
        activity: 'agent-run',
        activityEvents: [],
        sessionId: SESSION_ID,
        model: MODEL,
        mode: 'classic',
        startedAt: 0,
        parts: [],
        degraded: { reason: 'content-limit', omittedBytes: 1, toolCallIds },
      },
    ])

    const snapshot = getStreamBuffer(SESSION_ID)
    if (!snapshot) throw new Error('Expected a restored stream snapshot.')
    const restoredToolCallIds = snapshot.degraded?.toolCallIds ?? []
    const retainedContentBytes =
      Buffer.byteLength(JSON.stringify(snapshot.parts), 'utf8') +
      Buffer.byteLength(JSON.stringify(restoredToolCallIds), 'utf8')

    expect(restoredToolCallIds.length).toBeLessThan(toolCallIds.length)
    expect(retainedContentBytes).toBeLessThanOrEqual(MAX_ACTIVE_STREAM_BUFFER_BYTES + 2)
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(
      MAX_ACTIVE_STREAM_BUFFER_BYTES + 1_024,
    )
  })
})
