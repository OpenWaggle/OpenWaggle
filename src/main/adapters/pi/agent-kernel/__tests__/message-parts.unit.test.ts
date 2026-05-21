import { describe, expect, it } from 'vitest'
import {
  buildMessageNodeContentJson,
  buildRawNodeContentJson,
  piAssistantContentToParts,
  piTextAndImageContentToParts,
  piToolResultContentToPart,
} from '../message-parts'

describe('Pi message part projection helpers', () => {
  it('projects Pi user text and image content into renderer-safe text parts', () => {
    expect(piTextAndImageContentToParts('hello')).toEqual([{ type: 'text', text: 'hello' }])
    expect(
      piTextAndImageContentToParts([
        { type: 'text', text: 'caption' },
        { type: 'image', mimeType: 'image/png' },
        { type: 'unknown' },
      ]),
    ).toEqual([
      { type: 'text', text: 'caption' },
      { type: 'text', text: '[Image input: image/png]' },
    ])
    expect(piTextAndImageContentToParts({ invalid: true })).toEqual([{ type: 'text', text: '' }])
  })

  it('projects assistant text, reasoning, and tool calls while dropping unknown blocks', () => {
    expect(
      piAssistantContentToParts([
        { type: 'text', text: 'answer' },
        { type: 'thinking', thinking: 'reasoning' },
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'src/app.ts' } },
        { type: 'unknown' },
      ]),
    ).toEqual([
      { type: 'text', text: 'answer' },
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
    ])
  })

  it('returns an empty text part when assistant content has no displayable blocks', () => {
    expect(piAssistantContentToParts([{ type: 'unknown' }])).toEqual([{ type: 'text', text: '' }])
  })

  it('projects tool result details into a durable tool-result part', () => {
    expect(
      piToolResultContentToPart({
        toolCallId: 'tool-1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'done' }],
        isError: false,
        details: { args: { command: 'pwd' }, duration: 42 },
      }),
    ).toEqual({
      type: 'tool-result',
      toolResult: {
        id: 'tool-1',
        name: 'bash',
        args: { command: 'pwd' },
        result: {
          content: [{ type: 'text', text: 'done' }],
          details: { args: { command: 'pwd' }, duration: 42 },
        },
        isError: false,
        duration: 42,
        details: { args: { command: 'pwd' }, duration: 42 },
      },
    })
  })

  it('serializes message node content and raw metadata as JSON strings', () => {
    expect(
      JSON.parse(buildMessageNodeContentJson([{ type: 'text', text: 'hello' }], 'anthropic/model')),
    ).toEqual({
      parts: [{ type: 'text', text: 'hello' }],
      model: 'anthropic/model',
    })
    expect(JSON.parse(buildRawNodeContentJson({ source: 'pi' }))).toEqual({ source: 'pi' })
  })
})
