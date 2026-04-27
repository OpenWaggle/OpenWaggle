import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'

function createAssistantMessage(messageId: string): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts: [],
    createdAt: new Date(),
  }
}

function ensureAssistantMessage(messages: readonly UIMessage[], messageId: string): UIMessage[] {
  const existing = messages.find((message) => message.id === messageId)
  if (existing) {
    return [...messages]
  }
  return [...messages, createAssistantMessage(messageId)]
}

function replaceMessage(
  messages: readonly UIMessage[],
  messageId: string,
  update: (message: UIMessage) => UIMessage,
): UIMessage[] {
  let changed = false
  const nextMessages = messages.map((message) => {
    if (message.id !== messageId) {
      return message
    }
    changed = true
    return update(message)
  })
  return changed ? nextMessages : [...messages]
}

function findToolCallPartIndex(parts: readonly UIMessagePart[], toolCallId: string): number {
  return parts.findIndex((part) => part.type === 'tool-call' && part.id === toolCallId)
}

function findThinkingPartIndex(parts: readonly UIMessagePart[], stepId: string): number {
  return parts.findIndex((part) => part.type === 'thinking' && part.stepId === stepId)
}

function findLatestAssistantMessageId(messages: readonly UIMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') {
      return message.id
    }
  }
  return null
}

function findAssistantMessageIdForToolCall(
  messages: readonly UIMessage[],
  toolCallId: string,
): string | null {
  for (const message of messages) {
    if (
      message.role === 'assistant' &&
      message.parts.some((part) => part.type === 'tool-call' && part.id === toolCallId)
    ) {
      return message.id
    }
  }
  return null
}

function updateAssistantParts(
  messages: readonly UIMessage[],
  messageId: string,
  update: (parts: UIMessagePart[]) => UIMessagePart[],
): UIMessage[] {
  return replaceMessage(messages, messageId, (message) => ({
    ...message,
    parts: update(message.parts),
  }))
}

function appendTextDelta(
  messages: readonly UIMessage[],
  messageId: string,
  delta: string,
): UIMessage[] {
  const ensuredMessages = ensureAssistantMessage(messages, messageId)
  return updateAssistantParts(ensuredMessages, messageId, (parts) => {
    const lastPart = parts[parts.length - 1]
    if (lastPart?.type === 'text') {
      return [
        ...parts.slice(0, -1),
        {
          type: 'text',
          content: lastPart.content + delta,
        },
      ]
    }
    return [...parts, { type: 'text', content: delta }]
  })
}

function makeThinkingStepId(messageId: string, contentIndex: number): string {
  return `${messageId}:thinking:${String(contentIndex)}`
}

function ensureThinkingStep(
  messages: readonly UIMessage[],
  messageId: string,
  contentIndex: number,
): UIMessage[] {
  const stepId = makeThinkingStepId(messageId, contentIndex)
  return updateAssistantParts(ensureAssistantMessage(messages, messageId), messageId, (parts) => {
    const partIndex = findThinkingPartIndex(parts, stepId)
    if (partIndex !== -1) {
      return parts
    }

    return [...parts, { type: 'thinking', content: '', stepId }]
  })
}

function appendThinkingDelta(
  messages: readonly UIMessage[],
  messageId: string,
  contentIndex: number,
  delta: string,
): UIMessage[] {
  const stepId = makeThinkingStepId(messageId, contentIndex)
  const ensuredMessages = ensureThinkingStep(messages, messageId, contentIndex)
  return updateAssistantParts(ensuredMessages, messageId, (parts) => {
    const partIndex = findThinkingPartIndex(parts, stepId)
    if (partIndex === -1) {
      return parts
    }

    const part = parts[partIndex]
    if (!part || part.type !== 'thinking') {
      return parts
    }

    return [
      ...parts.slice(0, partIndex),
      {
        type: 'thinking',
        content: part.content + delta,
        stepId,
      },
      ...parts.slice(partIndex + 1),
    ]
  })
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input
  }

  if (input === undefined) {
    return ''
  }

  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function ensureToolCall(
  messages: readonly UIMessage[],
  messageId: string,
  toolCallId: string,
  toolName: string,
  input?: unknown,
): UIMessage[] {
  const ensuredMessages = ensureAssistantMessage(messages, messageId)
  return updateAssistantParts(ensuredMessages, messageId, (parts) => {
    const partIndex = findToolCallPartIndex(parts, toolCallId)
    if (partIndex !== -1) {
      return parts
    }
    return [
      ...parts,
      {
        type: 'tool-call',
        id: toolCallId,
        name: toolName,
        arguments: stringifyToolInput(input),
        state: input === undefined ? 'input-streaming' : 'input-complete',
      },
    ]
  })
}

function updateToolCall(
  messages: readonly UIMessage[],
  toolCallId: string,
  update: (part: Extract<UIMessagePart, { type: 'tool-call' }>) => UIMessagePart,
): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== 'tool-call' || part.id !== toolCallId) {
        return part
      }
      return update(part)
    }),
  }))
}

function appendToolCallArgs(
  messages: readonly UIMessage[],
  toolCallId: string,
  delta: string,
): UIMessage[] {
  return updateToolCall(messages, toolCallId, (part) => ({
    ...part,
    arguments: part.arguments + delta,
    state: 'input-streaming',
  }))
}

function updateToolCallInput(
  messages: readonly UIMessage[],
  toolCallId: string,
  input: unknown,
  state: string,
): UIMessage[] {
  return updateToolCall(messages, toolCallId, (part) => ({
    ...part,
    arguments: stringifyToolInput(input),
    state,
  }))
}

function finalizeToolCallInput(
  messages: readonly UIMessage[],
  toolCallId: string,
  input: unknown,
): UIMessage[] {
  return updateToolCall(messages, toolCallId, (part) => ({
    ...part,
    arguments: stringifyToolInput(input),
    state: 'input-complete',
  }))
}

function startToolExecution(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'tool_execution_start' }>,
): UIMessage[] {
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

function updateToolExecution(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'tool_execution_update' }>,
): UIMessage[] {
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

function finishToolExecution(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'tool_execution_end' }>,
): UIMessage[] {
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

function applyAssistantMessageEvent(
  messages: readonly UIMessage[],
  event: Extract<AgentTransportEvent, { type: 'message_update' }>,
): UIMessage[] {
  const assistantEvent = event.assistantMessageEvent

  if (assistantEvent.type === 'text_delta') {
    return appendTextDelta(messages, event.messageId, assistantEvent.delta)
  }

  if (assistantEvent.type === 'thinking_start') {
    return ensureThinkingStep(messages, event.messageId, assistantEvent.contentIndex)
  }

  if (assistantEvent.type === 'thinking_delta') {
    return appendThinkingDelta(
      messages,
      event.messageId,
      assistantEvent.contentIndex,
      assistantEvent.delta,
    )
  }

  if (assistantEvent.type === 'toolcall_start') {
    return ensureToolCall(
      messages,
      event.messageId,
      assistantEvent.toolCallId,
      assistantEvent.toolName,
      assistantEvent.input,
    )
  }

  if (assistantEvent.type === 'toolcall_delta') {
    if (assistantEvent.input !== undefined) {
      return updateToolCallInput(
        messages,
        assistantEvent.toolCallId,
        assistantEvent.input,
        'input-streaming',
      )
    }
    return appendToolCallArgs(messages, assistantEvent.toolCallId, assistantEvent.delta)
  }

  if (assistantEvent.type === 'toolcall_end') {
    const ensuredMessages = ensureToolCall(
      messages,
      event.messageId,
      assistantEvent.toolCallId,
      assistantEvent.toolName,
      assistantEvent.input,
    )
    return finalizeToolCallInput(ensuredMessages, assistantEvent.toolCallId, assistantEvent.input)
  }

  return [...messages]
}

export function applyAgentTransportEvent(
  messages: readonly UIMessage[],
  event: AgentTransportEvent,
): UIMessage[] {
  if (event.type === 'message_start' && event.role === 'assistant') {
    return ensureAssistantMessage(messages, event.messageId)
  }

  if (event.type === 'message_update') {
    return applyAssistantMessageEvent(messages, event)
  }

  if (event.type === 'tool_execution_start') {
    return startToolExecution(messages, event)
  }

  if (event.type === 'tool_execution_update') {
    return updateToolExecution(messages, event)
  }

  if (event.type === 'tool_execution_end') {
    return finishToolExecution(messages, event)
  }

  return [...messages]
}
