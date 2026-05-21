import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'

function createAssistantMessage(messageId: string): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts: [],
    createdAt: new Date(),
  }
}

export function ensureAssistantMessage(messages: readonly UIMessage[], messageId: string) {
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
) {
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

function findToolCallPartIndex(parts: readonly UIMessagePart[], toolCallId: string) {
  return parts.findIndex((part) => part.type === 'tool-call' && part.id === toolCallId)
}

function findThinkingPartIndex(parts: readonly UIMessagePart[], stepId: string) {
  return parts.findIndex((part) => part.type === 'thinking' && part.stepId === stepId)
}

export function findLatestAssistantMessageId(messages: readonly UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') {
      return message.id
    }
  }
  return null
}

export function findAssistantMessageIdForToolCall(
  messages: readonly UIMessage[],
  toolCallId: string,
) {
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

export function updateAssistantParts(
  messages: readonly UIMessage[],
  messageId: string,
  update: (parts: UIMessagePart[]) => UIMessagePart[],
) {
  return replaceMessage(messages, messageId, (message) => ({
    ...message,
    parts: update(message.parts),
  }))
}

export function appendTextDelta(messages: readonly UIMessage[], messageId: string, delta: string) {
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

function makeThinkingStepId(messageId: string, contentIndex: number) {
  return `${messageId}:thinking:${String(contentIndex)}`
}

export function ensureThinkingStep(
  messages: readonly UIMessage[],
  messageId: string,
  contentIndex: number,
) {
  const stepId = makeThinkingStepId(messageId, contentIndex)
  return updateAssistantParts(ensureAssistantMessage(messages, messageId), messageId, (parts) => {
    const partIndex = findThinkingPartIndex(parts, stepId)
    if (partIndex !== -1) {
      return parts
    }

    return [...parts, { type: 'thinking', content: '', stepId }]
  })
}

export function appendThinkingDelta(
  messages: readonly UIMessage[],
  messageId: string,
  contentIndex: number,
  delta: string,
) {
  const stepId = makeThinkingStepId(messageId, contentIndex)
  const ensuredMessages = ensureThinkingStep(messages, messageId, contentIndex)
  return updateAssistantParts(ensuredMessages, messageId, (parts) => {
    const partIndex = findThinkingPartIndex(parts, stepId)
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

export function stringifyToolInput(input: unknown) {
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

export function ensureToolCall(
  messages: readonly UIMessage[],
  messageId: string,
  toolCallId: string,
  toolName: string,
  input?: unknown,
) {
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

export function updateToolCall(
  messages: readonly UIMessage[],
  toolCallId: string,
  update: (part: Extract<UIMessagePart, { type: 'tool-call' }>) => UIMessagePart,
) {
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

export function appendToolCallArgs(
  messages: readonly UIMessage[],
  toolCallId: string,
  delta: string,
) {
  return updateToolCall(messages, toolCallId, (part) => ({
    ...part,
    arguments: part.arguments + delta,
    state: 'input-streaming',
  }))
}

export function updateToolCallInput(
  messages: readonly UIMessage[],
  toolCallId: string,
  input: unknown,
  state: string,
) {
  return updateToolCall(messages, toolCallId, (part) => ({
    ...part,
    arguments: stringifyToolInput(input),
    state,
  }))
}

export function finalizeToolCallInput(
  messages: readonly UIMessage[],
  toolCallId: string,
  input: unknown,
) {
  return updateToolCall(messages, toolCallId, (part) => ({
    ...part,
    arguments: stringifyToolInput(input),
    state: 'input-complete',
  }))
}
