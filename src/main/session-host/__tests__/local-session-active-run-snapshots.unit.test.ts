import { parseJsonUnknown } from '@shared/schema'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { NESTED_TOOL_CALL_LIMITS } from '@shared/utils/nested-tool-calls'
import { describe, expect, it } from 'vitest'
import { buildUserInputProjection } from '../../adapters/pi/agent-kernel/user-input-projection'
import {
  applyEventToStreamBuffer,
  clearStreamBuffer,
  getStreamBuffer,
  startStreamBuffer,
} from '../../utils/stream-buffer'
import { decodeActiveRunSnapshots } from '../local-session-active-run-snapshots'

const snapshot = {
  activity: 'agent-run',
  sessionId: 'session-running',
  model: 'provider/model',
  mode: 'classic',
  startedAt: 1,
  activityEvents: [],
  parts: [{ type: 'text', text: 'Partial answer' }],
}

const screenshot = {
  id: 'attachment-1',
  kind: 'image' as const,
  origin: 'browser-preview' as const,
  name: 'preview.png',
  path: '/tmp/preview.png',
  mimeType: 'image/png',
  sizeBytes: 128,
  contentSha256: 'b'.repeat(64),
  extractedText: '',
}

const userMessage = {
  messageId: 'user-incorporated',
  parts: buildUserInputProjection({ text: 'Queued question', attachments: [screenshot] }).parts,
  sessionNodeCreatedOrder: 7,
  durableTextSha256: 'c'.repeat(64),
  timestamp: 12,
  afterAssistantMessageId: 'assistant-1',
}

describe('decodeActiveRunSnapshots', () => {
  it('keeps the user messages the active Run already incorporated, attachments included', () => {
    expect(decodeActiveRunSnapshots([{ ...snapshot, userMessages: [userMessage] }])).toEqual([
      {
        ...snapshot,
        sessionId: SessionId('session-running'),
        model: SupportedModelId('provider/model'),
        userMessages: [userMessage],
      },
    ])
  })

  it('omits an empty user message list', () => {
    expect(decodeActiveRunSnapshots([{ ...snapshot, userMessages: [] }])[0]).not.toHaveProperty(
      'userMessages',
    )
  })

  it.each([
    ['an unknown field', { ...userMessage, raw: 'base64-image' }],
    ['a malformed digest', { ...userMessage, durableTextSha256: 'not-a-digest' }],
    ['a missing log order', { messageId: 'user', parts: [], timestamp: 1 }],
    ['a negative log order', { ...userMessage, sessionNodeCreatedOrder: -1 }],
    ['a fractional log order', { ...userMessage, sessionNodeCreatedOrder: 1.5 }],
    ['a missing timestamp', { ...userMessage, timestamp: undefined }],
    ['an image payload part', { ...userMessage, parts: [{ type: 'image', data: 'base64' }] }],
  ])('rejects a user message with %s', (_case, invalid) => {
    expect(() => decodeActiveRunSnapshots([{ ...snapshot, userMessages: [invalid] }])).toThrow()
  })

  /*
   * A newer Host keeps the Run's finished assistant messages (and when the streaming one started);
   * an older Host sends neither, and fields a later Host adds to a message are not read.
   */
  it('keeps the earlier assistant messages of the active Run, from any Host', () => {
    const earlier = {
      messageId: 'assistant-1',
      timestamp: 4,
      parts: [{ type: 'text', text: 'Earlier answer' }],
      laterField: true,
    }
    expect(
      decodeActiveRunSnapshots([
        { ...snapshot, messageStartedAt: 9, assistantMessages: [earlier] },
      ]),
    ).toEqual([
      expect.objectContaining({
        messageStartedAt: 9,
        assistantMessages: [
          {
            messageId: 'assistant-1',
            timestamp: 4,
            parts: [{ type: 'text', text: 'Earlier answer' }],
          },
        ],
      }),
    ])
    const [older] = decodeActiveRunSnapshots([snapshot])
    expect(older).not.toHaveProperty('assistantMessages')
    expect(older).not.toHaveProperty('messageStartedAt')
    expect(() =>
      decodeActiveRunSnapshots([{ ...snapshot, assistantMessages: [{ messageId: 'x' }] }]),
    ).toThrow()
  })

  // A newer Host keeps each text and reasoning part's content block; an older one sends none.
  it('keeps the content block of the text and reasoning parts', () => {
    const parts = [
      { type: 'reasoning', text: '', contentIndex: 0 },
      { type: 'text', text: 'Final answer', contentIndex: 1 },
    ]
    const [decoded] = decodeActiveRunSnapshots([{ ...snapshot, parts }])
    expect(decoded?.parts).toEqual(parts)
    expect(decodeActiveRunSnapshots([snapshot])[0]?.parts).toEqual(snapshot.parts)
  })

  it('keeps whether the caps cut the streaming message', () => {
    const degraded = { reason: 'content-limit', omittedBytes: 10, messageCutShort: false }
    expect(decodeActiveRunSnapshots([{ ...snapshot, degraded }])[0]?.degraded).toEqual(degraded)
    const unsaid = { reason: 'content-limit', omittedBytes: 10 }
    expect(decodeActiveRunSnapshots([{ ...snapshot, degraded: unsaid }])[0]?.degraded).toEqual({
      ...unsaid,
      messageCutShort: true,
    })
  })

  /*
   * The Host keeps a codemode call's nested calls on its tool-call part while the Run streams. A
   * snapshot decoder that did not know the field threw, which failed the whole subscription: every
   * Session then showed "Connecting" and "Thinking..." while its Runs finished in the Host.
   */
  it('keeps the nested calls the active Run buffer records on a codemode call', () => {
    const sessionId = SessionId('session-nested-snapshot')
    const apply = (event: AgentTransportEvent) => applyEventToStreamBuffer(sessionId, event)
    startStreamBuffer(sessionId, SupportedModelId('provider/model'), 'classic')
    try {
      apply({
        type: 'tool_execution_start',
        toolCallId: 'code-1',
        toolName: 'codemode',
        args: {},
        timestamp: 1,
      })
      for (let index = 1; index <= NESTED_TOOL_CALL_LIMITS.maxCalls + 1; index += 1) {
        const toolCallId = `code-1/${String(index)}`
        const nested = { toolCallId, toolName: 'read', parentToolCallId: 'code-1' }
        apply({ type: 'tool_execution_start', ...nested, args: { path: 'a.ts' }, timestamp: 2 })
        apply({ type: 'tool_execution_end', ...nested, result: 'ok', isError: false, timestamp: 3 })
      }
      apply({
        type: 'tool_execution_start',
        toolCallId: 'code-1/running',
        toolName: 'bash',
        args: { command: 'ls' },
        parentToolCallId: 'code-1',
        timestamp: 4,
      })
      // The wire copy, as the Host serialises it into the subscription frame.
      const parts = parseJsonUnknown(JSON.stringify(getStreamBuffer(sessionId)?.parts))
      expect(parts).toEqual([
        expect.objectContaining({
          toolCall: expect.objectContaining({
            nestedCalls: expect.objectContaining({ droppedCalls: 2, complete: false }),
          }),
        }),
      ])

      const [decoded] = decodeActiveRunSnapshots([{ ...snapshot, parts }])
      expect(decoded?.parts).toEqual(parts)
    } finally {
      clearStreamBuffer(sessionId)
    }
  })

  it('keeps the nested calls recorded on a tool result', () => {
    const nestedCalls = {
      calls: [
        { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok', durationMs: 3 },
        { id: 'code-1/2', name: 'bash', argsBytes: 90_000, status: 'error', error: 'exit 1' },
      ],
      complete: false,
    }
    const parts = [
      {
        type: 'tool-result',
        toolResult: {
          id: 'code-1',
          name: 'codemode',
          args: {},
          result: 'done',
          isError: false,
          duration: 12,
          nestedCalls,
        },
      },
    ]
    expect(decodeActiveRunSnapshots([{ ...snapshot, parts }])[0]?.parts).toEqual(parts)
  })

  it('rejects a nested call with an unknown status', () => {
    const parts = [
      {
        type: 'tool-call',
        toolCall: {
          id: 'code-1',
          name: 'codemode',
          args: {},
          nestedCalls: { calls: [{ id: 'x', name: 'read', status: 'pending' }], complete: false },
        },
      },
    ]
    expect(() => decodeActiveRunSnapshots([{ ...snapshot, parts }])).toThrow()
  })
})
