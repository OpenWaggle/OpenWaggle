import type { UIMessagePart } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { buildPartialAssistantMessage } from '../chat-message-conversion'
import { mergeBackgroundReconnectMessages } from '../chat-reconnect-merge'
import { appendThinkingDelta } from '../chat-stream-state-helpers'

/*
 * A reconnect merges the answer its buffer streams with the shown copy. The live view and the Host
 * buffer split an answer alike (a newer Host keeps each block's content index), but a stall can
 * drop a tool call or thinking block from the live view, and the byte caps can cut the buffer.
 */

const text = (content: string): UIMessagePart => ({ type: 'text', content })
const thought = (content: string, step?: number): UIMessagePart =>
  step === undefined
    ? { type: 'thinking', content }
    : { type: 'thinking', content, stepId: `a1:thinking:${String(step)}` }
const tool = (id: string): UIMessagePart => ({
  type: 'tool-call',
  id,
  name: 'bash',
  arguments: '{}',
  state: 'complete',
})

function merge(input: {
  readonly buffer: readonly UIMessagePart[]
  readonly shown: readonly UIMessagePart[]
  readonly baseline: readonly UIMessagePart[]
  readonly degraded?: boolean
}) {
  const answer = (parts: readonly UIMessagePart[]) => ({
    id: 'a1',
    role: 'assistant' as const,
    parts: [...parts],
  })
  return mergeBackgroundReconnectMessages([answer(input.buffer)], [answer(input.shown)], {
    streamingBaseline: {
      messageId: 'a1',
      parts: input.baseline,
      ...(input.degraded ? { degraded: true } : {}),
    },
  })
}

describe('reconnect merge of the streaming answer parts', () => {
  it('names the buffer thoughts by their content block, as the live view does', () => {
    const answer = buildPartialAssistantMessage(
      [
        { type: 'text', text: 'Preamble. ', contentIndex: 0 },
        { type: 'reasoning', text: '', contentIndex: 1 },
        { type: 'text', text: 'Final answer', contentIndex: 2 },
      ],
      'a1',
    )
    expect(answer?.parts).toEqual([text('Preamble. '), thought('', 1), text('Final answer')])
  })

  it('shows a text after an empty thought once', () => {
    const parts = [text('Preamble. '), thought('', 1), text('Final answer')]
    expect(merge({ buffer: parts, shown: parts, baseline: parts })[0]?.parts).toEqual(parts)
  })

  it('goes on with the last segment when a stall lost the tool call before it', () => {
    const merged = merge({
      buffer: [text('Plan.'), tool('c1'), text('Done')],
      shown: [text('Plan.Done more')],
      baseline: [text('Plan.Done')],
    })
    expect(merged[0]?.parts).toEqual([text('Plan.'), tool('c1'), text('Done more')])
  })

  it('goes on with the last segment when a stall lost the thought before it', () => {
    const merged = merge({
      buffer: [
        thought('think A', 0),
        text('X then report'),
        thought('checking it', 2),
        text('report'),
      ],
      shown: [thought('think A', 0), text('X then reportreport more')],
      baseline: [thought('think A', 0), text('X then reportreport')],
    })
    expect(merged[0]?.parts).toEqual([
      thought('think A', 0),
      text('X then report'),
      thought('checking it', 2),
      text('report more'),
    ])
  })

  it('streams on into its own thought when a stall lost an earlier one', () => {
    const merged = merge({
      buffer: [thought('thinking about X', 0), text('X then report'), thought('checking', 2)],
      shown: [text('X then report'), thought('checking it', 2)],
      baseline: [text('X then report'), thought('checking', 2)],
    })
    const expected = [
      thought('thinking about X', 0),
      text('X then report'),
      thought('checking it', 2),
    ]
    expect(merged[0]?.parts).toEqual(expected)
    expect(appendThinkingDelta(merged, 'a1', 2, ' further')[0]?.parts.at(-1)).toEqual(
      thought('checking it further', 2),
    )
  })

  it('keeps the shown answer whole when the buffer cut it at its byte caps', () => {
    const shown = [thought('think', 0), text('Long answer, cut here and finished.'), tool('c1')]
    const cut = merge({
      buffer: [thought('think', 0), text('Long answer, cut')],
      shown,
      baseline: shown,
      degraded: true,
    })
    expect(cut[0]?.parts).toEqual(shown)
    const dropped = [text('A'), tool('c1'), text('B')]
    expect(
      merge({ buffer: [text('AB')], shown: dropped, baseline: dropped, degraded: true })[0]?.parts,
    ).toEqual(dropped)
  })

  it('appends all of a thought shown only after the read, though the buffer has its start', () => {
    const merged = merge({
      buffer: [text('A'), thought('early', 1)],
      shown: [text('A'), thought(' later end', 1)],
      baseline: [text('A')],
    })
    expect(merged[0]?.parts).toEqual([text('A'), thought('early later end', 1)])
  })
})
