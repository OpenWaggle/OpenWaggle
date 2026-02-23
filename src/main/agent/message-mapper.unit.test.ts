import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { conversationToMessages } from './message-mapper'

describe('message-mapper screenshot injection', () => {
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

    const content = toolMsg.content as Array<Record<string, unknown>>
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
