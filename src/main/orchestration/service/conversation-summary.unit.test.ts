import type { Message, MessagePart } from '@shared/types/agent'
import { ConversationId, MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { describe, expect, it } from 'vitest'
import { summarizeConversation } from './conversation-summary'

function makeMessage(role: 'user' | 'assistant', parts: readonly MessagePart[]): Message {
  return {
    id: MessageId('msg-1'),
    role,
    parts,
    createdAt: Date.now(),
  }
}

function makeConversation(messages: Message[]): Conversation {
  return {
    id: ConversationId('conv-1'),
    title: 'Test Conversation',
    projectPath: '/test',
    messages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('summarizeConversation', () => {
  it('renders text parts with role prefix', () => {
    const conversation = makeConversation([
      makeMessage('user', [{ type: 'text', text: 'Hello' }]),
      makeMessage('assistant', [{ type: 'text', text: 'Hi there' }]),
    ])

    const result = summarizeConversation(conversation)

    expect(result).toBe('USER: Hello\nASSISTANT: Hi there')
  })

  it('renders reasoning parts as [reasoning]', () => {
    const conversation = makeConversation([
      makeMessage('assistant', [
        { type: 'reasoning', text: 'Let me think about this...' },
        { type: 'text', text: 'Here is my answer' },
      ]),
    ])

    const result = summarizeConversation(conversation)

    expect(result).toBe('ASSISTANT: [reasoning] Here is my answer')
  })

  it('renders tool-call parts as [tool:name]', () => {
    const conversation = makeConversation([
      makeMessage('assistant', [
        {
          type: 'tool-call',
          toolCall: {
            id: ToolCallId('tc-1'),
            name: 'readFile',
            args: { path: '/foo.ts' },
          },
        },
      ]),
    ])

    const result = summarizeConversation(conversation)

    expect(result).toBe('ASSISTANT: [tool:readFile]')
  })

  it('renders successful tool-result parts as [tool-done:name]', () => {
    const conversation = makeConversation([
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('tc-1'),
            name: 'readFile',
            args: { path: '/foo.ts' },
            result: 'file contents',
            isError: false,
            duration: 100,
          },
        },
      ]),
    ])

    const result = summarizeConversation(conversation)

    expect(result).toBe('ASSISTANT: [tool-done:readFile]')
  })

  it('renders error tool-result parts as [tool-error:name]', () => {
    const conversation = makeConversation([
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('tc-1'),
            name: 'writeFile',
            args: { path: '/foo.ts', content: '' },
            result: 'Permission denied',
            isError: true,
            duration: 50,
          },
        },
      ]),
    ])

    const result = summarizeConversation(conversation)

    expect(result).toBe('ASSISTANT: [tool-error:writeFile]')
  })

  it('skips attachment parts (renders as empty string)', () => {
    const conversation = makeConversation([
      makeMessage('user', [
        { type: 'text', text: 'See attached' },
        {
          type: 'attachment',
          attachment: {
            id: 'att-1',
            kind: 'text',
            name: 'file.txt',
            path: '/tmp/file.txt',
            mimeType: 'text/plain',
            sizeBytes: 100,
            extractedText: 'file content',
          },
        },
      ]),
    ])

    const result = summarizeConversation(conversation)

    // Attachment is skipped (empty segment filtered out)
    expect(result).toBe('USER: See attached')
  })

  it('combines multiple parts in a single message', () => {
    const conversation = makeConversation([
      makeMessage('assistant', [
        { type: 'text', text: 'Let me check' },
        {
          type: 'tool-call',
          toolCall: {
            id: ToolCallId('tc-1'),
            name: 'glob',
            args: { pattern: '*.ts' },
          },
        },
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('tc-1'),
            name: 'glob',
            args: { pattern: '*.ts' },
            result: 'foo.ts\nbar.ts',
            isError: false,
            duration: 20,
          },
        },
        { type: 'text', text: 'Found two files' },
      ]),
    ])

    const result = summarizeConversation(conversation)

    expect(result).toBe('ASSISTANT: Let me check [tool:glob] [tool-done:glob] Found two files')
  })

  it('only takes the last 8 messages', () => {
    const messages: Message[] = []
    for (let i = 0; i < 12; i++) {
      messages.push(
        makeMessage(i % 2 === 0 ? 'user' : 'assistant', [{ type: 'text', text: `Message ${i}` }]),
      )
    }

    const conversation = makeConversation(messages)
    const result = summarizeConversation(conversation)

    // Messages 0-3 should be excluded (only last 8: indices 4-11)
    expect(result).not.toContain('Message 0')
    expect(result).not.toContain('Message 3')
    expect(result).toContain('Message 4')
    expect(result).toContain('Message 11')
  })

  it('truncates output to 3000 characters with ellipsis', () => {
    const longText = 'A'.repeat(400)
    const messages: Message[] = []
    // Create enough messages to exceed 3000 chars
    for (let i = 0; i < 8; i++) {
      messages.push(makeMessage('user', [{ type: 'text', text: `${longText}-${i}` }]))
    }

    const conversation = makeConversation(messages)
    const result = summarizeConversation(conversation)

    // 8 messages x ("USER: " + 400 chars + "-X") + newlines > 3000
    expect(result.length).toBe(3003) // 3000 + '...'
    expect(result.endsWith('...')).toBe(true)
  })

  it('does not truncate when under the limit', () => {
    const conversation = makeConversation([
      makeMessage('user', [{ type: 'text', text: 'Short message' }]),
    ])

    const result = summarizeConversation(conversation)

    expect(result).toBe('USER: Short message')
    expect(result.endsWith('...')).toBe(false)
  })

  it('handles an empty conversation', () => {
    const conversation = makeConversation([])

    const result = summarizeConversation(conversation)

    expect(result).toBe('')
  })

  it('handles a message with no segments that produce text', () => {
    const conversation = makeConversation([
      makeMessage('user', [
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
      ]),
    ])

    const result = summarizeConversation(conversation)

    // Attachment produces empty string, so no segments -- but role prefix is still there
    expect(result).toBe('USER: ')
  })
})
