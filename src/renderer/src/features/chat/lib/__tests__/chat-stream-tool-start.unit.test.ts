import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { applyAgentTransportEvent } from '../chat-stream-state'
import { showsOnlyHiddenSessionsToolCalls } from '../sessions-tool-visibility'

function applyEvents(events: readonly AgentTransportEvent[]) {
  let messages: UIMessage[] = []
  for (const event of events) messages = applyAgentTransportEvent(messages, event)
  return messages
}

function toolEvent(
  assistantMessageEvent: Extract<
    AgentTransportEvent,
    { type: 'message_update' }
  >['assistantMessageEvent'],
): AgentTransportEvent {
  return {
    type: 'message_update',
    messageId: 'assistant-1',
    role: 'assistant',
    assistantMessageEvent,
    timestamp: 2,
  }
}

const START: AgentTransportEvent = {
  type: 'message_start',
  messageId: 'assistant-1',
  role: 'assistant',
  timestamp: 1,
}

describe('a streamed tool call that starts with empty input', () => {
  it('stays streaming, so a Worker wait never shows before its action arrives', () => {
    const started = applyEvents([
      START,
      toolEvent({
        type: 'toolcall_start',
        contentIndex: 0,
        toolCallId: 't1',
        toolName: 'hive',
        input: {},
      }),
    ])
    expect(started.at(-1)?.parts.at(-1)).toMatchObject({
      type: 'tool-call',
      state: 'input-streaming',
    })
    expect(showsOnlyHiddenSessionsToolCalls(started.at(-1)?.parts ?? [])).toBe(true)

    const waited = applyEvents([
      START,
      toolEvent({
        type: 'toolcall_start',
        contentIndex: 0,
        toolCallId: 't1',
        toolName: 'hive',
        input: {},
      }),
      toolEvent({
        type: 'toolcall_delta',
        contentIndex: 0,
        toolCallId: 't1',
        delta: '{"action":"wait"}',
        input: { action: 'wait' },
      }),
    ])
    expect(showsOnlyHiddenSessionsToolCalls(waited.at(-1)?.parts ?? [])).toBe(true)
  })

  it('keeps canonical start input complete', () => {
    const messages = applyEvents([
      START,
      toolEvent({
        type: 'toolcall_start',
        contentIndex: 0,
        toolCallId: 't1',
        toolName: 'read',
        input: { path: 'src/app.ts' },
      }),
    ])
    expect(messages.at(-1)?.parts.at(-1)).toMatchObject({ state: 'input-complete' })
  })
})
