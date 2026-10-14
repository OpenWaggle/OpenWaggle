import type { SchemaType } from '@shared/schema'
import type {
  AttachmentPart,
  AttachmentRecord,
  MessagePart,
  ReasoningPart,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from '@shared/types/agent'
import type { ToolCallRequest, ToolCallResult } from '@shared/types/tools'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  decodeAssistantMessageSnapshots,
  decodeStreamingParts,
  type messagePartSchema,
} from '../local-session-snapshot-parts'

const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('../../logger', () => ({ createLogger: () => logged }))

const SECRET = 'rm -rf /very/secret/path'
const context = { sessionId: 'session-1', runId: 'run-1' }
const undecodable = {
  type: 'tool-call',
  toolCall: {
    id: 'code-1',
    name: 'codemode',
    args: { command: SECRET },
    nestedCalls: {
      calls: [{ id: 'x', name: 'bash', args: { command: SECRET }, status: 'pending' }],
      complete: false,
    },
  },
}

describe('snapshot part decode reports', () => {
  it('logs one line per dropped part with where it failed, never what it held', () => {
    logged.error.mockClear()
    decodeStreamingParts(
      { parts: [{ type: 'text', text: SECRET }, undecodable], messageId: 'm' },
      context,
    )

    expect(logged.error).toHaveBeenCalledTimes(1)
    const [message, data] = logged.error.mock.calls[0] ?? []
    expect(message).toMatch(/streaming message part/)
    expect(data).toMatchObject({
      sessionId: 'session-1',
      runId: 'run-1',
      messageId: 'm',
      partIndex: 1,
      partType: 'tool-call',
    })
    expect(data?.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^toolCall\./)]))
    expect(JSON.stringify(data)).not.toContain('secret')
  })

  it('names the earlier assistant message it leaves out, without its content', () => {
    logged.error.mockClear()
    decodeAssistantMessageSnapshots(
      [{ messageId: 'assistant-1', timestamp: 1, parts: [undecodable] }],
      context,
    )

    expect(logged.error).toHaveBeenCalledWith(
      expect.stringMatching(/earlier assistant message/),
      expect.objectContaining({ sessionId: 'session-1', messageId: 'assistant-1' }),
    )
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain('secret')
  })
})

/*
 * The decode is exact: a field `MessagePart` gains that the snapshot schema does not list makes
 * every part carrying it undecodable. Hold the keys of each member, and of the records inside it.
 */
type SnapshotPart = SchemaType<typeof messagePartSchema>
/** The member whose `type` literals include `TType` (text and reasoning share one struct). */
type Member<TUnion, TType> = TUnion extends { readonly type: infer TTypes }
  ? TType extends TTypes
    ? TUnion
    : never
  : never

describe('messagePartSchema', () => {
  it('lists every field of each MessagePart member', () => {
    expectTypeOf<keyof Member<SnapshotPart, 'text'>>().toEqualTypeOf<keyof TextPart>()
    expectTypeOf<keyof Member<SnapshotPart, 'reasoning'>>().toEqualTypeOf<keyof ReasoningPart>()
    expectTypeOf<keyof Member<SnapshotPart, 'attachment'>['attachment']>().toEqualTypeOf<
      keyof AttachmentRecord
    >()
    expectTypeOf<keyof Member<SnapshotPart, 'tool-call'>['toolCall']>().toEqualTypeOf<
      keyof ToolCallRequest
    >()
    expectTypeOf<keyof Member<SnapshotPart, 'tool-result'>['toolResult']>().toEqualTypeOf<
      keyof ToolCallResult
    >()
    expectTypeOf<keyof Member<SnapshotPart, 'attachment'>>().toEqualTypeOf<keyof AttachmentPart>()
    expectTypeOf<keyof Member<SnapshotPart, 'tool-call'>>().toEqualTypeOf<keyof ToolCallPart>()
    expectTypeOf<keyof Member<SnapshotPart, 'tool-result'>>().toEqualTypeOf<keyof ToolResultPart>()
    expectTypeOf<SnapshotPart['type']>().toEqualTypeOf<MessagePart['type']>()
  })

  // Keys miss a widened literal or value type; every part the Host can send must still decode.
  it('accepts every value a MessagePart can hold', () => {
    expectTypeOf<MessagePart>().toExtend<SnapshotPart>()
  })
})
