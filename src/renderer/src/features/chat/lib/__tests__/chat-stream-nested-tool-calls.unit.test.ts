import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { applyAgentTransportEvent } from '../chat-stream-state'

function applyEvents(events: readonly AgentTransportEvent[]) {
  let messages: UIMessage[] = []
  for (const event of events) {
    messages = applyAgentTransportEvent(messages, event)
  }
  return messages
}

describe('applyAgentTransportEvent nested tool calls', () => {
  const readResult = { content: [{ type: 'text', text: 'file a' }], details: null }

  function codemodeStart(): AgentTransportEvent[] {
    return [
      { type: 'message_start', messageId: 'assistant-1', role: 'assistant', timestamp: 1 },
      {
        type: 'tool_execution_start',
        toolCallId: 'code-1',
        toolName: 'codemode',
        args: { code: 'read()' },
        parentMessageId: 'assistant-1',
        timestamp: 2,
      },
    ]
  }

  it('attaches nested calls to their parent tool call instead of creating tool cards', () => {
    const messages = applyEvents([
      ...codemodeStart(),
      {
        type: 'tool_execution_start',
        toolCallId: 'code-1/1',
        toolName: 'read',
        args: { path: 'a.ts' },
        parentToolCallId: 'code-1',
        timestamp: 3,
      },
      {
        type: 'tool_execution_update',
        toolCallId: 'code-1/1',
        toolName: 'read',
        args: { path: 'a.ts' },
        partialResult: 'partial',
        parentToolCallId: 'code-1',
        timestamp: 4,
      },
      {
        type: 'tool_execution_start',
        toolCallId: 'code-1/1/1',
        toolName: 'bash',
        args: { command: 'ls' },
        parentToolCallId: 'code-1/1',
        timestamp: 5,
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'code-1/1/1',
        toolName: 'bash',
        result: 'boom',
        isError: true,
        parentToolCallId: 'code-1/1',
        timestamp: 6,
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'code-1/1',
        toolName: 'read',
        args: { path: 'a.ts' },
        result: readResult,
        isError: false,
        parentToolCallId: 'code-1',
        timestamp: 7,
      },
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]?.parts).toEqual([
      {
        type: 'tool-call',
        id: 'code-1',
        name: 'codemode',
        arguments: '{"code":"read()"}',
        state: 'executing',
        nestedCalls: [
          {
            id: 'code-1/1',
            name: 'read',
            arguments: '{"path":"a.ts"}',
            state: 'complete',
            output: readResult,
          },
          {
            id: 'code-1/1/1',
            name: 'bash',
            arguments: '{"command":"ls"}',
            state: 'error',
            output: 'boom',
          },
        ],
      },
    ])
  })

  it('drops nested calls whose parent tool call is unknown', () => {
    const before = applyEvents(codemodeStart())
    const messages = applyEvents([
      ...codemodeStart(),
      {
        type: 'tool_execution_start',
        toolCallId: 'other/1',
        toolName: 'read',
        args: { path: 'a.ts' },
        parentToolCallId: 'other',
        timestamp: 3,
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'other/1',
        toolName: 'read',
        result: readResult,
        isError: false,
        parentToolCallId: 'other',
        timestamp: 4,
      },
    ])

    expect(messages.map((message) => message.parts)).toEqual(before.map((message) => message.parts))
  })
})
