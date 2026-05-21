import { matchBy } from '@diegogbrisa/ts-match'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  appendTextDelta,
  appendThinkingDelta,
  appendToolCallArgs,
  ensureThinkingStep,
  ensureToolCall,
  finalizeToolCallInput,
  updateToolCallInput,
} from './chat-stream-state-helpers'

export function applyAssistantMessageEvent(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'message_update' }>,
) {
  const assistantEvent = event.assistantMessageEvent
  const cloneMessages = () => messages.slice()

  return matchBy(assistantEvent, 'type')
    .with('text_start', cloneMessages)
    .with('text_delta', (value) => appendTextDelta(messages, event.messageId, value.delta))
    .with('text_end', cloneMessages)
    .with('thinking_start', (value) =>
      ensureThinkingStep(messages, event.messageId, value.contentIndex),
    )
    .with('thinking_delta', (value) =>
      appendThinkingDelta(messages, event.messageId, value.contentIndex, value.delta),
    )
    .with('thinking_end', cloneMessages)
    .with('toolcall_start', (value) =>
      ensureToolCall(messages, event.messageId, value.toolCallId, value.toolName, value.input),
    )
    .with('toolcall_delta', (value) =>
      value.input !== undefined
        ? updateToolCallInput(messages, value.toolCallId, value.input, 'input-streaming')
        : appendToolCallArgs(messages, value.toolCallId, value.delta),
    )
    .with('toolcall_end', (value) => {
      const ensuredMessages = ensureToolCall(
        messages,
        event.messageId,
        value.toolCallId,
        value.toolName,
        value.input,
      )
      return finalizeToolCallInput(ensuredMessages, value.toolCallId, value.input)
    })
    .with('done', 'error', cloneMessages)
    .exhaustive()
}
