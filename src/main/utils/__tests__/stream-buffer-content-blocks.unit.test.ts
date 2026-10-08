import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  replaceStreamBufferSnapshots,
  startStreamBuffer,
} from '../stream-buffer'

/*
 * The buffer splits an answer into parts as the renderer's live view does, and names each text and
 * reasoning part by its content block, so a reconnect can tell which shown part each one is.
 */

const SESSION_ID = SessionId('session-stream-buffer-content-blocks')
const MODEL = SupportedModelId('anthropic/claude-sonnet-4-5')
const MESSAGE_ID = 'assistant-1'

type AssistantEvent = Extract<
  AgentTransportEvent,
  { type: 'message_update' }
>['assistantMessageEvent']

function apply(assistantMessageEvent: AssistantEvent, messageId = MESSAGE_ID) {
  applyEventToStreamBuffer(SESSION_ID, {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent,
    timestamp: 0,
  })
}

function start(messageId: string) {
  applyEventToStreamBuffer(SESSION_ID, {
    type: 'message_start',
    messageId,
    role: 'assistant',
    timestamp: 0,
  })
}

describe('stream-buffer content blocks', () => {
  afterEach(() => clearStreamBuffer(SESSION_ID))

  it('opens a thinking block at its start, so an empty one still separates two texts', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    apply({ type: 'text_delta', contentIndex: 0, delta: 'Preamble. ' })
    apply({ type: 'thinking_start', contentIndex: 1 })
    apply({ type: 'thinking_end', contentIndex: 1, content: '' })
    apply({ type: 'text_delta', contentIndex: 2, delta: 'Final answer' })
    expect(getStreamBuffer(SESSION_ID)?.parts).toEqual([
      { type: 'text', text: 'Preamble. ', contentIndex: 0 },
      { type: 'reasoning', text: '', contentIndex: 1 },
      { type: 'text', text: 'Final answer', contentIndex: 2 },
    ])
  })

  it('appends each thinking delta to its own block', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    apply({ type: 'thinking_delta', contentIndex: 0, delta: 'first' })
    apply({ type: 'thinking_start', contentIndex: 1 })
    apply({ type: 'thinking_delta', contentIndex: 1, delta: 'second' })
    apply({ type: 'thinking_delta', contentIndex: 0, delta: ' more' })
    expect(getStreamBuffer(SESSION_ID)?.parts).toEqual([
      { type: 'reasoning', text: 'first more', contentIndex: 0 },
      { type: 'reasoning', text: 'second', contentIndex: 1 },
    ])
  })

  // The caps count over the Run; a snapshot says whether they cut the message it streams.
  it('reports only a cut in the streaming message as cutting it', () => {
    startStreamBuffer(SESSION_ID, MODEL, 'classic', 'run-1')
    start('a1')
    apply(
      {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'x'.repeat(MAX_ACTIVE_STREAM_BUFFER_BYTES + 1),
      },
      'a1',
    )
    expect(getStreamBuffer(SESSION_ID)?.degraded?.messageCutShort).toBe(true)
    start('a2')
    apply({ type: 'text_delta', contentIndex: 0, delta: 'Plan.' }, 'a2')
    expect(getStreamBuffer(SESSION_ID)?.degraded).toMatchObject({ messageCutShort: false })
  })

  it('restores a snapshot whose omissions were an earlier message as holding this one whole', () => {
    const snapshot = (messageCutShort: boolean): BackgroundRunSnapshot => ({
      activity: 'agent-run',
      sessionId: SESSION_ID,
      runId: 'run-1',
      model: MODEL,
      mode: 'classic',
      startedAt: 1,
      activityEvents: [],
      messageId: 'a2',
      parts: [{ type: 'text', text: 'Plan.', contentIndex: 0 }],
      degraded: {
        reason: 'content-limit',
        omittedBytes: 10,
        messageCutShort,
      },
    })
    // The next message retains the restored one in the Run's history only when it was whole.
    for (const [cutShort, retained] of [
      [false, 1],
      [true, 0],
    ] as const) {
      replaceStreamBufferSnapshots([snapshot(cutShort)])
      start('a3')
      expect(getStreamBuffer(SESSION_ID)?.assistantMessages ?? []).toHaveLength(retained)
      clearStreamBuffer(SESSION_ID)
    }
  })
})
