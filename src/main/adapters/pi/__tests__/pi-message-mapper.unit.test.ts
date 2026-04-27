import { describe, expect, it } from 'vitest'
import { piHistoryToProjectedMessages } from '../pi-message-mapper'

describe('piHistoryToProjectedMessages', () => {
  it('collapses assistant and following toolResult messages back into OpenWaggle assistant messages', () => {
    const result = piHistoryToProjectedMessages([
      {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [
          { type: 'text', text: 'I will inspect the file.' },
          { type: 'thinking', thinking: 'Need to read before editing.' },
          { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'README.md' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-1',
        toolName: 'read',
        content: [{ type: 'text', text: 'README content' }],
        isError: false,
        details: { args: { path: 'README.md' }, duration: 12 },
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('assistant')
    expect(result[0]?.parts.map((part) => part.type)).toEqual([
      'text',
      'reasoning',
      'tool-call',
      'tool-result',
    ])
    expect(result[0]?.parts.at(-1)).toMatchObject({
      type: 'tool-result',
      toolResult: {
        id: 'tool-1',
        name: 'read',
        args: { path: 'README.md' },
        result: {
          content: [{ type: 'text', text: 'README content' }],
          details: { args: { path: 'README.md' }, duration: 12 },
        },
        isError: false,
        duration: 12,
        details: { args: { path: 'README.md' }, duration: 12 },
      },
    })
  })

  it('preserves Pi edit diff details when projecting tool results', () => {
    const result = piHistoryToProjectedMessages([
      {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [
          { type: 'toolCall', id: 'tool-1', name: 'edit', arguments: { path: 'src/app.ts' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-1',
        toolName: 'edit',
        content: [{ type: 'text', text: 'Successfully replaced 1 block(s).' }],
        isError: false,
        details: {
          args: { path: 'src/app.ts' },
          duration: 42,
          diff: '@@ -1 +1 @@\n-old\n+new',
          firstChangedLine: 1,
        },
      },
    ])

    expect(result[0]?.parts.at(-1)).toMatchObject({
      type: 'tool-result',
      toolResult: {
        result: {
          content: [{ type: 'text', text: 'Successfully replaced 1 block(s).' }],
          details: {
            args: { path: 'src/app.ts' },
            duration: 42,
            diff: '@@ -1 +1 @@\n-old\n+new',
            firstChangedLine: 1,
          },
        },
        details: {
          args: { path: 'src/app.ts' },
          duration: 42,
          diff: '@@ -1 +1 @@\n-old\n+new',
          firstChangedLine: 1,
        },
      },
    })
  })
})
