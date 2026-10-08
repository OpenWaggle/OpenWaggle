import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { applyAgentTransportEvent } from '../chat-stream-state'

function applyEvents(events: readonly AgentTransportEvent[]) {
  let messages: UIMessage[] = []
  for (const event of events) messages = applyAgentTransportEvent(messages, event)
  return messages
}

describe('applyAgentTransportEvent answers whose start was lost', () => {
  it('dates an answer a tool start begins by Host time, not the renderer clock', () => {
    const [answer] = applyEvents([
      {
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'ls' },
        parentMessageId: 'assistant-1',
        timestamp: 42,
      },
    ])
    expect(answer?.id).toBe('assistant-1')
    expect(answer?.createdAt).toEqual(new Date(42))
  })
})
