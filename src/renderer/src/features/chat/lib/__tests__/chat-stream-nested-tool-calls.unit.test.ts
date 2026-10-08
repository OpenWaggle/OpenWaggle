import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { NESTED_TOOL_CALL_LIMITS } from '@shared/utils/nested-tool-calls'
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
        // Pi's bounded record: no results, so a long script cannot fill renderer state.
        nestedCalls: {
          calls: [
            { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok' },
            {
              id: 'code-1/1/1',
              name: 'bash',
              args: { command: 'ls' },
              status: 'error',
              error: 'boom',
            },
          ],
          complete: true,
        },
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

  it('keeps as many nested calls as Pi does and counts the ones past the cap', () => {
    const calls = NESTED_TOOL_CALL_LIMITS.maxCalls + 5
    const events: AgentTransportEvent[] = [...codemodeStart()]
    for (let index = 1; index <= calls; index += 1) {
      const toolCallId = `code-1/${String(index)}`
      events.push(
        {
          type: 'tool_execution_start',
          toolCallId,
          toolName: 'read',
          args: { path: `${String(index)}.ts` },
          parentToolCallId: 'code-1',
          timestamp: 3,
        },
        {
          type: 'tool_execution_end',
          toolCallId,
          toolName: 'read',
          result: readResult,
          isError: false,
          parentToolCallId: 'code-1',
          timestamp: 4,
        },
      )
    }

    const part = applyEvents(events)[0]?.parts[0]
    const nestedCalls = part?.type === 'tool-call' ? part.nestedCalls : undefined
    expect(nestedCalls?.calls).toHaveLength(NESTED_TOOL_CALL_LIMITS.maxCalls)
    expect(nestedCalls?.droppedCalls).toBe(5)
    expect(nestedCalls?.complete).toBe(false)
  })
})
