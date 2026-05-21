import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  ensureToolCall,
  findAssistantMessageIdForToolCall,
  findLatestAssistantMessageId,
  stringifyToolInput,
  updateAssistantParts,
  updateToolCall,
} from './chat-stream-state-helpers'

export function startToolExecution(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'tool_execution_start' }>,
) {
  const targetAssistantId = event.parentMessageId ?? findLatestAssistantMessageId(messages)
  const ensuredMessages = targetAssistantId
    ? ensureToolCall(messages, targetAssistantId, event.toolCallId, event.toolName, event.args)
    : [...messages]

  return updateToolCall(ensuredMessages, event.toolCallId, (part) => ({
    ...part,
    arguments: stringifyToolInput(event.args),
    state: 'executing',
  }))
}

export function updateToolExecution(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'tool_execution_update' }>,
) {
  const targetAssistantId =
    findAssistantMessageIdForToolCall(messages, event.toolCallId) ??
    findLatestAssistantMessageId(messages)
  const ensuredMessages = targetAssistantId
    ? ensureToolCall(messages, targetAssistantId, event.toolCallId, event.toolName, event.args)
    : [...messages]

  return updateToolCall(ensuredMessages, event.toolCallId, (part) => ({
    ...part,
    arguments: stringifyToolInput(event.args),
    state: 'executing',
    partialOutput: event.partialResult,
  }))
}

export function finishToolExecution(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'tool_execution_end' }>,
) {
  const targetAssistantId =
    findAssistantMessageIdForToolCall(messages, event.toolCallId) ??
    findLatestAssistantMessageId(messages)
  const ensuredMessages = targetAssistantId
    ? ensureToolCall(messages, targetAssistantId, event.toolCallId, event.toolName, event.args)
    : [...messages]

  const finalState = event.isError ? 'error' : 'complete'
  const updatedMessages = updateToolCall(ensuredMessages, event.toolCallId, (part) => ({
    ...part,
    arguments: event.args === undefined ? part.arguments : stringifyToolInput(event.args),
    state: finalState,
    output: event.result,
    partialOutput: undefined,
  }))

  const resultAssistantId = findAssistantMessageIdForToolCall(updatedMessages, event.toolCallId)
  if (!resultAssistantId) {
    return updatedMessages
  }

  return updateAssistantParts(updatedMessages, resultAssistantId, (parts) => {
    const withoutPreviousResult = parts.filter(
      (part) => part.type !== 'tool-result' || part.toolCallId !== event.toolCallId,
    )
    return [
      ...withoutPreviousResult,
      {
        type: 'tool-result',
        toolCallId: event.toolCallId,
        content: event.result,
        state: finalState,
        ...(event.isError && typeof event.result === 'string'
          ? {
              error: event.result,
            }
          : {}),
      },
    ]
  })
}
