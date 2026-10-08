import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBufferSnapshots,
  listStreamBuffers,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  replaceStreamBufferSnapshots,
  startStreamBuffer,
  startStreamBufferFromAgentStart,
} from '../stream-buffer'
import { MAX_RUN_HISTORY_BYTES, MAX_TOTAL_RUN_HISTORY_BYTES } from '../stream-buffer-history'

const SESSION_ID = SessionId('session-stream-buffer-assistant-messages')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')
const KIB = 1024

function clearAllBuffers() {
  for (const buffer of listStreamBuffers()) clearStreamBuffer(buffer.sessionId)
}

function apply(event: AgentTransportEvent) {
  applyEventToStreamBuffer(SESSION_ID, event)
}

function assistantStart(messageId: string, timestamp: number): AgentTransportEvent {
  return { type: 'message_start', messageId, role: 'assistant', timestamp }
}

function text(messageId: string, delta: string): AgentTransportEvent {
  return {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
    timestamp: 0,
  }
}

function toolRun(messageId: string, toolCallId: string): AgentTransportEvent[] {
  const args = { command: 'ls' }
  return [
    {
      type: 'tool_execution_start',
      toolCallId,
      toolName: 'bash',
      args,
      parentMessageId: messageId,
      timestamp: 0,
    },
    {
      type: 'tool_execution_end',
      toolCallId,
      toolName: 'bash',
      result: 'ok',
      isError: false,
      timestamp: 0,
    },
  ]
}

/*
 * A Run's messages reach the persisted transcript only when it ends. The stream buffer keeps the
 * Run's finished assistant messages beside the one streaming, so a reconnect (a renderer reload
 * mid-Run) still shows them.
 */
describe('stream-buffer assistant messages', () => {
  beforeEach(clearAllBuffers)
  afterEach(clearAllBuffers)

  it('keeps each finished assistant message, its tools included, as the next one starts', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    apply(assistantStart('assistant-1', 10))
    apply(text('assistant-1', 'reading the store'))
    for (const event of toolRun('assistant-1', 'tool-1')) apply(event)
    apply(assistantStart('assistant-2', 20))
    apply(text('assistant-2', 'done'))

    const snapshot = getStreamBuffer(SESSION_ID)
    expect(snapshot).toMatchObject({
      messageId: 'assistant-2',
      messageStartedAt: 20,
      parts: [{ type: 'text', text: 'done' }],
      assistantMessages: [
        {
          messageId: 'assistant-1',
          timestamp: 10,
          parts: [
            { type: 'text', text: 'reading the store', contentIndex: 0 },
            { type: 'tool-call', toolCall: expect.objectContaining({ id: 'tool-1' }) },
            { type: 'tool-result', toolResult: expect.objectContaining({ id: 'tool-1' }) },
          ],
        },
      ],
    })

    // A resync's snapshot restores them, and the next message keeps adding to them.
    if (!snapshot) throw new Error('No buffer')
    replaceStreamBufferSnapshots([snapshot])
    apply(assistantStart('assistant-3', 30))
    expect(getStreamBuffer(SESSION_ID)?.assistantMessages).toEqual([
      expect.objectContaining({ messageId: 'assistant-1', timestamp: 10 }),
      {
        messageId: 'assistant-2',
        timestamp: 20,
        parts: [{ type: 'text', text: 'done', contentIndex: 0 }],
      },
    ])
  })

  it('leaves out a message the live caps cut short', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    apply(assistantStart('assistant-1', 10))
    apply(text('assistant-1', 'x'.repeat(MAX_ACTIVE_STREAM_BUFFER_BYTES + 1)))
    apply(assistantStart('assistant-2', 20))
    expect(getStreamBuffer(SESSION_ID)?.assistantMessages).toBeUndefined()
  })

  /*
   * The history has its own budget: in a long Run its oldest messages go first, and the message
   * streaming now keeps the whole live budget, in its Session and in any other.
   */
  it('evicts the oldest history first, and never crowds out the live message', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    const turns = 100
    for (let index = 0; index < turns; index += 1) {
      apply(assistantStart(`m-${String(index)}`, index))
      apply(text(`m-${String(index)}`, 'r'.repeat(45 * KIB)))
    }
    apply(assistantStart('live', turns))
    apply(text('live', 'a'.repeat(200 * KIB)))
    const snapshot = getStreamBuffer(SESSION_ID)
    expect(snapshot?.parts).toEqual([
      { type: 'text', text: 'a'.repeat(200 * KIB), contentIndex: 0 },
    ])
    expect(snapshot?.degraded).toBeUndefined()
    const history = snapshot?.assistantMessages ?? []
    // The newest finished messages, in order, within the history budget.
    expect(history.at(-1)?.messageId).toBe(`m-${String(turns - 1)}`)
    expect(history.length).toBeGreaterThan(10)
    expect(history.length).toBeLessThan(turns)
    expect(Buffer.byteLength(JSON.stringify(history), 'utf8')).toBeLessThanOrEqual(
      MAX_RUN_HISTORY_BYTES,
    )

    // Another Session's live message keeps its own budget beside this history.
    const other = SessionId('session-stream-buffer-assistant-messages-other')
    startStreamBuffer(other, MODEL, 'classic', 'run-2')
    applyEventToStreamBuffer(other, assistantStart('other-live', 1))
    applyEventToStreamBuffer(other, text('other-live', 'b'.repeat(2.5 * 1024 * KIB)))
    expect(getStreamBuffer(other)?.parts).toHaveLength(1)
    expect(Buffer.byteLength(JSON.stringify(listStreamBufferSnapshots()), 'utf8')).toBeLessThan(
      8 * 1024 * KIB,
    )
  })

  it('keeps the history of all buffers within its total budget', () => {
    const sessions = [0, 1, 2].map((index) => SessionId(`history-session-${String(index)}`))
    for (const sessionId of sessions) {
      startStreamBuffer(sessionId, MODEL, 'classic', `run-${sessionId}`)
      for (let index = 0; index < 30; index += 1) {
        applyEventToStreamBuffer(sessionId, assistantStart(`${sessionId}-${String(index)}`, index))
        applyEventToStreamBuffer(
          sessionId,
          text(`${sessionId}-${String(index)}`, 'h'.repeat(40 * KIB)),
        )
      }
      applyEventToStreamBuffer(sessionId, assistantStart(`${sessionId}-live`, 99))
    }
    const histories = listStreamBufferSnapshots().map(
      (snapshot) => snapshot.assistantMessages ?? [],
    )
    const total = histories.reduce(
      (bytes, history) => bytes + Buffer.byteLength(JSON.stringify(history), 'utf8'),
      0,
    )
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_RUN_HISTORY_BYTES)
    // The first buffers keep theirs; one started once the budget is spent keeps none.
    expect(histories.map((history) => history.length > 0)).toEqual([true, true, false])
  })

  it('starts each Run without the previous Run messages', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    apply(assistantStart('assistant-1', 10))
    apply(text('assistant-1', 'first'))
    apply(assistantStart('assistant-2', 20))
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-2')
    expect(getStreamBuffer(SESSION_ID)?.assistantMessages).toBeUndefined()
  })

  /*
   * A Waggle the agent requests (`waggle-of-<X>`) goes on with Run X, persisted only when X ends:
   * its buffer keeps X's start, user messages and finished answers, on the Host and in the replica.
   */
  it('keeps the classic Run content through the Waggle it requested', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-X')
    apply({
      type: 'message_start',
      messageId: 'prompt',
      role: 'user',
      userMessage: { parts: [{ type: 'text', text: 'Fix it' }], sessionNodeCreatedOrder: 1 },
      timestamp: 5,
    })
    apply(assistantStart('assistant-1', 10))
    apply(text('assistant-1', 'reading'))
    const startedAt = getStreamBuffer(SESSION_ID)?.startedAt
    startStreamBuffer(SESSION_ID, MODEL, 'waggle', 'waggle-of-run-X')
    expect(getStreamBuffer(SESSION_ID)).toMatchObject({
      runId: 'waggle-of-run-X',
      startedAt,
      parts: [],
      userMessages: [expect.objectContaining({ messageId: 'prompt' })],
      assistantMessages: [expect.objectContaining({ messageId: 'assistant-1' })],
    })
    startStreamBufferFromAgentStart(SESSION_ID, {
      type: 'agent_start',
      runId: 'waggle-of-run-X',
      timestamp: 30,
    })
    expect(getStreamBuffer(SESSION_ID)?.assistantMessages).toHaveLength(1)
    // Another Run starts empty.
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-Y')
    expect(getStreamBuffer(SESSION_ID)).not.toHaveProperty('assistantMessages')
    expect(getStreamBuffer(SESSION_ID)).not.toHaveProperty('userMessages')
  })

  it('takes the message a degraded snapshot streams for cut short, and keeps the next', () => {
    replaceStreamBufferSnapshots([
      {
        activity: 'agent-run',
        sessionId: SESSION_ID,
        runId: 'run-1',
        model: MODEL,
        mode: 'classic',
        startedAt: 1,
        activityEvents: [],
        messageId: 'assistant-1',
        messageStartedAt: 2,
        parts: [{ type: 'text', text: 'the part that fit' }],
        degraded: { reason: 'content-limit', omittedBytes: 64, messageCutShort: true },
      },
    ])
    apply(assistantStart('assistant-2', 10))
    apply(text('assistant-2', 'whole'))
    apply(assistantStart('assistant-3', 20))
    expect(getStreamBuffer(SESSION_ID)?.assistantMessages?.map((m) => m.messageId)).toEqual([
      'assistant-2',
    ])
  })
})
