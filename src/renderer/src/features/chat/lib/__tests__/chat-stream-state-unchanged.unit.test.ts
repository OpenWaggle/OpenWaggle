import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { applyAgentTransportEvent } from '../chat-stream-state'

describe('applyAgentTransportEvent events that change no message', () => {
  it('returns the messages it was given', () => {
    const messages: readonly UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', content: 'Hi' }] },
    ]
    const events: readonly AgentTransportEvent[] = [
      { type: 'agent_start', runId: 'run-1', timestamp: 1 },
      { type: 'turn_start', turnIndex: 0, timestamp: 2 },
      { type: 'message_end', messageId: 'assistant-1', role: 'assistant', timestamp: 3 },
      { type: 'compaction_start', reason: 'threshold', timestamp: 4 },
      { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 5 },
    ]
    for (const event of events) {
      expect(applyAgentTransportEvent(messages, event)).toBe(messages)
    }
  })
})
