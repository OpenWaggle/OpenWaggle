import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { SimpleChatMessage } from '../message-mapper'
import { microcompactConversationMessages, microcompactMessages } from '../message-mapper'

// ─── Helpers ─────────────────────────────────────────────────

function makeToolMessage(toolCallId: string, content: string): SimpleChatMessage {
  return { role: 'tool', content, toolCallId }
}

function makeAssistantMessage(
  text: string,
  toolCalls?: Array<{ id: string; name: string; args: string }>,
): SimpleChatMessage {
  return {
    role: 'assistant',
    content: text,
    toolCalls: toolCalls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.args },
    })),
  }
}

function makeUserMessage(text: string): SimpleChatMessage {
  return { role: 'user', content: text }
}

function makeDomainMessage(
  role: 'user' | 'assistant',
  parts: Message['parts'],
  id?: string,
): Message {
  return {
    id: MessageId(id ?? `msg-${Math.random().toString(36).slice(7)}`),
    role,
    parts,
    createdAt: Date.now(),
  }
}

// ─── microcompactMessages (SimpleChatMessage[]) ─────────────

describe('microcompactMessages', () => {
  it('returns messages unchanged when tool results are within threshold', () => {
    const messages: SimpleChatMessage[] = [
      makeUserMessage('hello'),
      makeAssistantMessage('ok', [{ id: 'tc1', name: 'readFile', args: '{}' }]),
      makeToolMessage('tc1', 'file content here'),
    ]

    const { messages: result, strippedCount } = microcompactMessages(messages, {
      recentToolResultCount: 5,
    })

    expect(strippedCount).toBe(0)
    expect(result[2]?.content).toBe('file content here')
  })

  it('strips old tool results beyond the recent threshold', () => {
    const messages: SimpleChatMessage[] = [
      makeUserMessage('read files'),
      makeAssistantMessage('reading 3 files', [
        { id: 'tc1', name: 'readFile', args: '{"path":"a.ts"}' },
        { id: 'tc2', name: 'readFile', args: '{"path":"b.ts"}' },
        { id: 'tc3', name: 'readFile', args: '{"path":"c.ts"}' },
      ]),
      makeToolMessage('tc1', 'content of a.ts — very long content...'),
      makeToolMessage('tc2', 'content of b.ts — very long content...'),
      makeToolMessage('tc3', 'content of c.ts — very long content...'),
    ]

    const { messages: result, strippedCount } = microcompactMessages(messages, {
      recentToolResultCount: 1,
    })

    expect(strippedCount).toBe(2)
    // tc1 and tc2 should be stripped (oldest), tc3 kept (most recent)
    expect(result[2]?.content).toBe('[Tool result cleared — readFile]')
    expect(result[3]?.content).toBe('[Tool result cleared — readFile]')
    expect(result[4]?.content).toBe('content of c.ts — very long content...')
  })

  it('preserves assistant text and tool call metadata', () => {
    const messages: SimpleChatMessage[] = [
      makeUserMessage('do things'),
      makeAssistantMessage('I will read the file', [
        { id: 'tc1', name: 'readFile', args: '{"path":"x.ts"}' },
      ]),
      makeToolMessage('tc1', 'file content'),
      makeAssistantMessage('Now I will edit', [
        { id: 'tc2', name: 'editFile', args: '{"path":"x.ts"}' },
      ]),
      makeToolMessage('tc2', 'edit result'),
    ]

    const { messages: result } = microcompactMessages(messages, { recentToolResultCount: 1 })

    // Assistant text preserved
    expect(result[1]?.content).toBe('I will read the file')
    expect(result[3]?.content).toBe('Now I will edit')
    // Assistant toolCalls preserved
    expect(result[1]?.toolCalls).toHaveLength(1)
    expect(result[3]?.toolCalls).toHaveLength(1)
  })

  it('generates placeholder with tool name from preceding assistant message', () => {
    const messages: SimpleChatMessage[] = [
      makeAssistantMessage('running command', [
        { id: 'tc1', name: 'runCommand', args: '{"cmd":"ls"}' },
      ]),
      makeToolMessage('tc1', 'lots of output...'),
      makeAssistantMessage('reading file', [
        { id: 'tc2', name: 'readFile', args: '{"path":"foo.ts"}' },
      ]),
      makeToolMessage('tc2', 'file content'),
    ]

    const { messages: result } = microcompactMessages(messages, { recentToolResultCount: 1 })

    expect(result[1]?.content).toBe('[Tool result cleared — runCommand]')
    expect(result[3]?.content).toBe('file content') // most recent, kept
  })

  it('handles conversation with no tool messages', () => {
    const messages: SimpleChatMessage[] = [
      makeUserMessage('hello'),
      makeAssistantMessage('hi there', undefined),
    ]

    const { messages: result, strippedCount } = microcompactMessages(messages)

    expect(strippedCount).toBe(0)
    expect(result).toHaveLength(2)
  })

  it('handles empty message array', () => {
    const { messages: result, strippedCount } = microcompactMessages([])
    expect(strippedCount).toBe(0)
    expect(result).toHaveLength(0)
  })

  it('falls back to generic placeholder when toolCallId has no match', () => {
    const messages: SimpleChatMessage[] = [
      makeToolMessage('orphan-id', 'orphan tool result'),
      makeAssistantMessage('more work', [{ id: 'tc2', name: 'readFile', args: '{}' }]),
      makeToolMessage('tc2', 'kept result'),
    ]

    const { messages: result } = microcompactMessages(messages, { recentToolResultCount: 1 })

    expect(result[0]?.content).toBe('[Tool result cleared]')
  })

  it('uses default of 5 recent tool results when no options provided', () => {
    const messages: SimpleChatMessage[] = []
    // Add 7 tool results
    for (let i = 0; i < 7; i++) {
      messages.push(
        makeAssistantMessage(`step ${i}`, [{ id: `tc${i}`, name: 'readFile', args: '{}' }]),
      )
      messages.push(makeToolMessage(`tc${i}`, `result ${i}`))
    }

    const { strippedCount } = microcompactMessages(messages)
    expect(strippedCount).toBe(2) // 7 - 5 = 2 stripped
  })
})

// ─── microcompactConversationMessages (domain Message[]) ────

describe('microcompactConversationMessages', () => {
  it('strips old tool result parts from domain messages', () => {
    const messages: Message[] = [
      makeDomainMessage('assistant', [
        { type: 'text', text: 'Reading files' },
        {
          type: 'tool-call',
          toolCall: { id: ToolCallId('tc1'), name: 'readFile', args: { path: 'a.ts' } },
        },
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('tc1'),
            name: 'readFile',
            args: { path: 'a.ts' },
            result: 'long file content of a.ts...',
            isError: false,
            duration: 100,
          },
        },
      ]),
      makeDomainMessage('assistant', [
        { type: 'text', text: 'Reading more' },
        {
          type: 'tool-call',
          toolCall: { id: ToolCallId('tc2'), name: 'readFile', args: { path: 'b.ts' } },
        },
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('tc2'),
            name: 'readFile',
            args: { path: 'b.ts' },
            result: 'long file content of b.ts...',
            isError: false,
            duration: 50,
          },
        },
      ]),
    ]

    const { messages: result, strippedCount } = microcompactConversationMessages(messages, {
      recentToolResultCount: 1,
    })

    expect(strippedCount).toBe(1)
    // First message's tool result should be stripped
    const firstToolResult = result[0]?.parts.find((p) => p.type === 'tool-result')
    expect(firstToolResult?.type === 'tool-result' && firstToolResult.toolResult.result).toBe(
      '[Tool result cleared — readFile]',
    )
    // Second message's tool result should be kept (most recent)
    const secondToolResult = result[1]?.parts.find((p) => p.type === 'tool-result')
    expect(secondToolResult?.type === 'tool-result' && secondToolResult.toolResult.result).toBe(
      'long file content of b.ts...',
    )
  })

  it('preserves text and tool-call parts', () => {
    const messages: Message[] = [
      makeDomainMessage('assistant', [
        { type: 'text', text: 'Important analysis' },
        {
          type: 'tool-call',
          toolCall: { id: ToolCallId('tc1'), name: 'readFile', args: { path: 'x.ts' } },
        },
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('tc1'),
            name: 'readFile',
            args: { path: 'x.ts' },
            result: 'content',
            isError: false,
            duration: 10,
          },
        },
      ]),
      makeDomainMessage('assistant', [
        { type: 'text', text: 'More analysis' },
        {
          type: 'tool-call',
          toolCall: { id: ToolCallId('tc2'), name: 'editFile', args: {} },
        },
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('tc2'),
            name: 'editFile',
            args: {},
            result: 'edited',
            isError: false,
            duration: 20,
          },
        },
      ]),
    ]

    const { messages: result } = microcompactConversationMessages(messages, {
      recentToolResultCount: 1,
    })

    // Text parts preserved
    const firstText = result[0]?.parts.find((p) => p.type === 'text')
    expect(firstText?.type === 'text' && firstText.text).toBe('Important analysis')
    // Tool-call parts preserved
    const firstToolCall = result[0]?.parts.find((p) => p.type === 'tool-call')
    expect(firstToolCall?.type === 'tool-call' && firstToolCall.toolCall.name).toBe('readFile')
  })

  it('leaves user messages untouched', () => {
    const userMsg = makeDomainMessage('user', [{ type: 'text', text: 'hello world' }])
    const { messages: result } = microcompactConversationMessages([userMsg], {
      recentToolResultCount: 1,
    })
    expect(result[0]).toBe(userMsg) // Same reference — not modified
  })

  it('handles messages with no tool results', () => {
    const messages: Message[] = [
      makeDomainMessage('assistant', [{ type: 'text', text: 'just text' }]),
    ]
    const { strippedCount } = microcompactConversationMessages(messages)
    expect(strippedCount).toBe(0)
  })
})
