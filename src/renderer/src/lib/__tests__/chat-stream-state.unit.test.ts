import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { applyAgentTransportEvent } from '../chat-stream-state'

function applyEvents(events: readonly AgentTransportEvent[]): UIMessage[] {
  let messages: UIMessage[] = []
  for (const event of events) {
    messages = applyAgentTransportEvent(messages, event)
  }
  return messages
}

describe('applyAgentTransportEvent reasoning streaming', () => {
  it('accumulates reasoning deltas into a single inline thinking part', () => {
    const messages = applyEvents([
      {
        type: 'message_start',
        messageId: 'assistant-1',
        role: 'assistant',
        timestamp: 1,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'thinking_start',
          contentIndex: 0,
        },
        timestamp: 2,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: 'Plan',
        },
        timestamp: 3,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: ' the edit',
        },
        timestamp: 4,
      },
    ])

    expect(messages[0]?.parts).toEqual([
      {
        type: 'thinking',
        content: 'Plan the edit',
        stepId: 'assistant-1:thinking:0',
      },
    ])
  })

  it('preserves reasoning order around tool calls and later assistant text', () => {
    const messages = applyEvents([
      {
        type: 'message_start',
        messageId: 'assistant-1',
        role: 'assistant',
        timestamp: 1,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'thinking_start',
          contentIndex: 0,
        },
        timestamp: 2,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: 'Inspect file first.',
        },
        timestamp: 3,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'toolcall_start',
          contentIndex: 1,
          toolCallId: 'tool-1',
          toolName: 'read',
          input: { path: 'src/app.ts' },
        },
        timestamp: 4,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'toolcall_end',
          contentIndex: 1,
          toolCallId: 'tool-1',
          toolName: 'read',
          input: { path: 'src/app.ts' },
        },
        timestamp: 6,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'thinking_start',
          contentIndex: 2,
        },
        timestamp: 7,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 2,
          delta: 'Now prepare the change.',
        },
        timestamp: 8,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 3,
          delta: 'Done.',
        },
        timestamp: 9,
      },
    ])

    expect(messages[0]?.parts).toEqual([
      {
        type: 'thinking',
        content: 'Inspect file first.',
        stepId: 'assistant-1:thinking:0',
      },
      {
        type: 'tool-call',
        id: 'tool-1',
        name: 'read',
        arguments: '{"path":"src/app.ts"}',
        state: 'input-complete',
      },
      {
        type: 'thinking',
        content: 'Now prepare the change.',
        stepId: 'assistant-1:thinking:2',
      },
      {
        type: 'text',
        content: 'Done.',
      },
    ])
  })

  it('tracks Pi tool execution start, partial output, and final success', () => {
    const partialResult = { content: [{ type: 'text', text: 'installing...' }], details: null }
    const finalResult = {
      content: [{ type: 'text', text: 'done' }],
      details: { fullOutputPath: null },
    }

    const messages = applyEvents([
      {
        type: 'message_start',
        messageId: 'assistant-1',
        role: 'assistant',
        timestamp: 1,
      },
      {
        type: 'message_update',
        messageId: 'assistant-1',
        role: 'assistant',
        assistantMessageEvent: {
          type: 'toolcall_start',
          contentIndex: 0,
          toolCallId: 'tool-1',
          toolName: 'bash',
          input: { command: 'pnpm test' },
        },
        timestamp: 2,
      },
      {
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'pnpm test' },
        parentMessageId: 'assistant-1',
        timestamp: 3,
      },
      {
        type: 'tool_execution_update',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'pnpm test' },
        partialResult,
        timestamp: 4,
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'pnpm test' },
        result: finalResult,
        isError: false,
        timestamp: 5,
      },
    ])

    expect(messages[0]?.parts).toEqual([
      {
        type: 'tool-call',
        id: 'tool-1',
        name: 'bash',
        arguments: '{"command":"pnpm test"}',
        state: 'complete',
        output: finalResult,
        partialOutput: undefined,
      },
      {
        type: 'tool-result',
        toolCallId: 'tool-1',
        content: finalResult,
        state: 'complete',
      },
    ])
  })

  it('preserves Pi tool execution errors and replaces duplicate terminal results', () => {
    const firstError = { content: [{ type: 'text', text: 'first failure' }], details: null }
    const finalError = { content: [{ type: 'text', text: 'final failure' }], details: null }

    const messages = applyEvents([
      {
        type: 'message_start',
        messageId: 'assistant-1',
        role: 'assistant',
        timestamp: 1,
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'false' },
        result: firstError,
        isError: true,
        timestamp: 2,
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'false' },
        result: finalError,
        isError: true,
        timestamp: 3,
      },
    ])

    expect(messages[0]?.parts).toEqual([
      {
        type: 'tool-call',
        id: 'tool-1',
        name: 'bash',
        arguments: '{"command":"false"}',
        state: 'error',
        output: finalError,
        partialOutput: undefined,
      },
      {
        type: 'tool-result',
        toolCallId: 'tool-1',
        content: finalError,
        state: 'error',
      },
    ])
  })
})
