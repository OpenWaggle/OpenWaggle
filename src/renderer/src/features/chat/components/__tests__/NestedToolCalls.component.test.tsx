import { SessionId, ToolCallId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { NESTED_TOOL_CALL_LIMITS } from '@shared/utils/nested-tool-calls'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { messagePartToUIParts } from '@/features/chat/lib/chat-message-conversion'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { AssistantMessageBubble } from '../AssistantMessageBubble'

vi.mock('@/features/session-summary', () => ({ SessionMessageImages: () => null }))

const runtime = {
  sessionId: SessionId('session-1'),
  extensions: { registry: null, projectPaths: [] },
}

function renderAssistant(message: UIMessage, isStreaming: boolean) {
  render(<AssistantMessageBubble message={message} runtime={runtime} run={{ isStreaming }} />)
}

function toolCards() {
  return screen.getAllByRole('button', { name: /details$/ })
}

/*
 * Pi 1.0 runs the calls a tool makes through ctx.executeTool() as nested tool executions with
 * their own events but no transcript entry. They belong under the calling tool's card.
 */
describe('nested tool calls', () => {
  it('renders live nested calls under their parent tool card and never as cards of their own', () => {
    const events: AgentTransportEvent[] = [
      { type: 'message_start', messageId: 'assistant-1', role: 'assistant', timestamp: 1 },
      {
        type: 'tool_execution_start',
        toolCallId: 'code-1',
        toolName: 'codemode',
        args: { code: 'read()' },
        parentMessageId: 'assistant-1',
        timestamp: 2,
      },
      {
        type: 'tool_execution_start',
        toolCallId: 'code-1/1',
        toolName: 'read',
        args: { path: 'src/a.ts' },
        parentToolCallId: 'code-1',
        timestamp: 3,
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'code-1/1',
        toolName: 'read',
        args: { path: 'src/a.ts' },
        result: 'file a',
        isError: false,
        parentToolCallId: 'code-1',
        timestamp: 4,
      },
      {
        type: 'tool_execution_start',
        toolCallId: 'code-1/2',
        toolName: 'read',
        args: { path: 'src/b.ts' },
        parentToolCallId: 'code-1',
        timestamp: 5,
      },
    ]
    const messages = events.reduce<UIMessage[]>(applyAgentTransportEvent, [])

    expect(messages).toHaveLength(1)
    const [message] = messages
    if (!message) throw new Error('expected the assistant message')
    renderAssistant(message, true)

    const nested = screen.getByRole('list', { name: 'Tool calls made by codemode' })
    expect(within(nested).getByRole('button', { name: /^Read src\/a\.ts/ })).toBeInTheDocument()
    expect(within(nested).getByRole('button', { name: /^Reading src\/b\.ts/ })).toBeInTheDocument()
    const topLevelCards = toolCards().filter((card) => !nested.contains(card))
    expect(topLevelCards).toHaveLength(1)
  })

  it('renders the nested calls Pi recorded on a persisted parent result after reload', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-call',
          id: 'code-1',
          name: 'codemode',
          arguments: '{}',
          state: 'input-complete',
        },
        ...messagePartToUIParts({
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('code-1'),
            name: 'codemode',
            args: {},
            result: 'done',
            isError: false,
            duration: 0,
            nestedCalls: {
              complete: true,
              calls: [
                { id: 'code-1/1', name: 'read', args: { path: 'src/a.ts' }, status: 'ok' },
                {
                  id: 'code-1/2',
                  name: 'write',
                  argsBytes: 90_000,
                  status: 'error',
                  error: 'denied',
                },
              ],
            },
          },
        }),
      ],
    }

    renderAssistant(message, false)

    const nested = screen.getByRole('list', { name: 'Tool calls made by codemode' })
    expect(within(nested).getAllByRole('listitem')).toHaveLength(2)
    expect(within(nested).getByRole('button', { name: /^Read src\/a\.ts/ })).toBeInTheDocument()
    // Pi left the write call's arguments out of its record for size.
    expect(within(nested).getByText('Arguments not recorded')).toBeInTheDocument()
    expect(toolCards().filter((card) => !nested.contains(card))).toHaveLength(1)
  })

  it('says a nested call result was not recorded instead of showing an empty Result', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-call',
          id: 'code-1',
          name: 'codemode',
          arguments: '{}',
          state: 'input-complete',
        },
        ...messagePartToUIParts({
          type: 'tool-result',
          toolResult: {
            id: ToolCallId('code-1'),
            name: 'codemode',
            args: {},
            result: 'done',
            isError: false,
            duration: 0,
            nestedCalls: {
              complete: true,
              calls: [
                { id: 'code-1/1', name: 'mcp__docs__search', args: { query: 'pi' }, status: 'ok' },
              ],
            },
          },
        }),
      ],
    }
    renderAssistant(message, false)
    const nested = screen.getByRole('list', { name: 'Tool calls made by codemode' })

    fireEvent.click(within(nested).getByRole('button', { name: /details$/ }))

    // Pi keeps no result for a nested call.
    expect(within(nested).getByText('Result not recorded')).toBeInTheDocument()
    expect(within(nested).queryByText('Result', { exact: true })).not.toBeInTheDocument()
  })

  it('caps a long live list the way Pi caps its record and says how many calls it left out', () => {
    const events: AgentTransportEvent[] = [
      { type: 'message_start', messageId: 'assistant-1', role: 'assistant', timestamp: 1 },
      {
        type: 'tool_execution_start',
        toolCallId: 'code-1',
        toolName: 'codemode',
        args: { code: 'loop()' },
        parentMessageId: 'assistant-1',
        timestamp: 2,
      },
    ]
    for (let index = 1; index <= NESTED_TOOL_CALL_LIMITS.maxCalls + 4; index += 1) {
      const toolCallId = `code-1/${String(index)}`
      events.push(
        {
          type: 'tool_execution_start',
          toolCallId,
          toolName: 'read',
          args: { path: `src/${String(index)}.ts` },
          parentToolCallId: 'code-1',
          timestamp: 3,
        },
        {
          type: 'tool_execution_end',
          toolCallId,
          toolName: 'read',
          result: 'contents',
          isError: false,
          parentToolCallId: 'code-1',
          timestamp: 4,
        },
      )
    }
    const [message] = events.reduce<UIMessage[]>(applyAgentTransportEvent, [])
    if (!message) throw new Error('expected the assistant message')
    renderAssistant(message, true)

    const nested = screen.getByRole('list', { name: 'Tool calls made by codemode' })
    expect(within(nested).getAllByRole('listitem')).toHaveLength(NESTED_TOOL_CALL_LIMITS.maxCalls)
    expect(screen.getByText('4 more tool calls not shown')).toBeInTheDocument()
  })
})
