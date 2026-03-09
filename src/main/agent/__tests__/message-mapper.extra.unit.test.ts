import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { conversationToMessages } from '../message-mapper'

describe('conversationToMessages — user message mapping', () => {
  it('maps a simple text user message', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'user',
        parts: [{ type: 'text', text: 'Hello world' }],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'Hello world' })
  })

  it('handles user attachment with extracted text', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'user',
        parts: [
          { type: 'text', text: 'Check this file' },
          {
            type: 'attachment',
            attachment: {
              id: 'att-1',
              kind: 'text',
              name: 'readme.md',
              path: '/tmp/readme.md',
              mimeType: 'text/markdown',
              sizeBytes: 100,
              extractedText: '# My Project\nSome content here',
            },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('Check this file')
    expect(result[0].content).toContain('[Attachment: readme.md]')
    expect(result[0].content).toContain('# My Project')
  })

  it('handles user attachment without extracted text', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'user',
        parts: [
          {
            type: 'attachment',
            attachment: {
              id: 'att-1',
              kind: 'image',
              name: 'photo.png',
              path: '/tmp/photo.png',
              mimeType: 'image/png',
              sizeBytes: 5000,
              extractedText: '',
            },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('[Attachment: photo.png]')
    expect(result[0].content).not.toContain('\n')
  })

  it('maps multiple user parts with text and attachments', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'user',
        parts: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('First part')
    expect(result[0].content).toContain('Second part')
  })

  it('maps assistant message with text and tool calls', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        parts: [
          { type: 'text', text: 'I will read the file' },
          {
            type: 'tool-call',
            toolCall: { id: ToolCallId('tc-1'), name: 'readFile', args: { path: 'test.ts' } },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId('tc-1'),
              name: 'readFile',
              args: { path: 'test.ts' },
              result: 'file content',
              isError: false,
              duration: 50,
            },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result).toHaveLength(2) // assistant + tool result
    expect(result[0].role).toBe('assistant')
    expect(result[0].content).toBe('I will read the file')
    expect(result[0].toolCalls).toHaveLength(1)
    expect(result[0].toolCalls?.[0].function.name).toBe('readFile')
    expect(result[1].role).toBe('tool')
    expect(result[1].content).toBe('file content')
  })

  it('maps assistant message with no text (null content) and omits unresolved tool calls', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCall: { id: ToolCallId('tc-1'), name: 'glob', args: { pattern: '**/*.ts' } },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result[0].content).toBeNull()
    expect(result[0].toolCalls).toBeUndefined()
  })

  it('maps a multi-message conversation', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'user',
        parts: [{ type: 'text', text: 'What is in test.ts?' }],
        createdAt: Date.now(),
      },
      {
        id: MessageId('msg-2'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'Let me check' }],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('user')
    expect(result[1].role).toBe('assistant')
  })
})
