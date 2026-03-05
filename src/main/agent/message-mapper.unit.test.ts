import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { conversationToMessages } from './message-mapper'

describe('message-mapper screenshot injection', () => {
  it('omits unresolved assistant tool calls from provider replay history', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-unresolved'),
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'I attempted a command.',
          },
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tc-unresolved'),
              name: 'runCommand',
              args: { command: 'echo hello' },
            },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      role: 'assistant',
      content: 'I attempted a command.',
    })
    expect(result[0]?.toolCalls).toBeUndefined()
  })

  it('injects multimodal image content for browserScreenshot tool results', () => {
    const screenshotData = {
      kind: 'json',
      data: {
        base64Image: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        pageTitle: 'Example',
        url: 'https://example.com',
      },
    }

    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tc-1'),
              name: 'browserScreenshot',
              args: {},
            },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId('tc-1'),
              name: 'browserScreenshot',
              args: {},
              result: JSON.stringify(screenshotData),
              isError: false,
              duration: 100,
            },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)

    // Should have assistant message + tool result
    expect(result).toHaveLength(2)

    const toolMsg = result[1]
    expect(toolMsg.role).toBe('tool')
    expect(Array.isArray(toolMsg.content)).toBe(true)

    if (!Array.isArray(toolMsg.content)) {
      throw new Error('Expected multimodal array content for browserScreenshot result.')
    }
    const content = toolMsg.content
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({
      type: 'text',
      content: 'Screenshot of https://example.com (Example)',
    })
    expect(content[1]).toEqual({
      type: 'image',
      source: {
        type: 'data',
        value: 'iVBORw0KGgo=',
        mimeType: 'image/png',
      },
    })
  })

  it('falls back to plain string for non-screenshot tool results', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tc-1'),
              name: 'readFile',
              args: { path: 'test.ts' },
            },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId('tc-1'),
              name: 'readFile',
              args: { path: 'test.ts' },
              result: 'file content here',
              isError: false,
              duration: 50,
            },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    const toolMsg = result[1]
    expect(toolMsg.content).toBe('file content here')
  })

  it('falls back to plain string for malformed screenshot data', () => {
    const messages: Message[] = [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tc-1'),
              name: 'browserScreenshot',
              args: {},
            },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId('tc-1'),
              name: 'browserScreenshot',
              args: {},
              result: 'not json',
              isError: false,
              duration: 100,
            },
          },
        ],
        createdAt: Date.now(),
      },
    ]

    const result = conversationToMessages(messages)
    const toolMsg = result[1]
    expect(toolMsg.content).toBe('not json')
  })
})
