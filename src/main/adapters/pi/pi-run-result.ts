import { randomUUID } from 'node:crypto'
import type { Message, MessagePart, PreparedAttachment } from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { isRecord } from '@shared/utils/validation'
import { piHistoryToProjectedMessages } from './pi-message-mapper'

function makeMessage(
  role: 'user' | 'assistant' | 'system',
  parts: MessagePart[],
  model?: SupportedModelId,
): Message {
  return {
    id: MessageId(randomUUID()),
    role,
    parts,
    model,
    createdAt: Date.now(),
  }
}

interface PiPersistablePayload {
  readonly text: string
  readonly attachments: readonly PreparedAttachment[]
}

function buildPersistedUserMessageParts(payload: PiPersistablePayload): MessagePart[] {
  const parts: MessagePart[] = []
  if (payload.text.trim()) {
    parts.push({ type: 'text', text: payload.text.trim() })
  }
  for (const attachment of payload.attachments) {
    const persisted: PreparedAttachment = {
      id: attachment.id,
      kind: attachment.kind,
      origin: attachment.origin,
      name: attachment.name,
      path: attachment.path,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      extractedText: attachment.extractedText,
    }
    parts.push({ type: 'attachment', attachment: persisted })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

interface PiRuntimeAssistantMessage {
  readonly role: 'assistant'
  readonly content: readonly unknown[]
  readonly model: string
  readonly stopReason?: string
  readonly errorMessage?: string
}

interface PiRuntimeToolResultMessage {
  readonly role: 'toolResult'
  readonly toolCallId: string
  readonly toolName: string
  readonly content: readonly unknown[]
  readonly isError: boolean
  readonly details?: unknown
}

function isPiRuntimeAssistantMessage(value: unknown): value is PiRuntimeAssistantMessage {
  if (!isRecord(value)) {
    return false
  }
  if (value.role !== 'assistant') {
    return false
  }
  if (!Array.isArray(value.content)) {
    return false
  }
  if (typeof value.model !== 'string') {
    return false
  }
  if (
    'stopReason' in value &&
    value.stopReason !== undefined &&
    typeof value.stopReason !== 'string'
  ) {
    return false
  }
  if (
    'errorMessage' in value &&
    value.errorMessage !== undefined &&
    typeof value.errorMessage !== 'string'
  ) {
    return false
  }
  return true
}

function isPiRuntimeToolResultMessage(value: unknown): value is PiRuntimeToolResultMessage {
  if (!isRecord(value)) {
    return false
  }
  return (
    value.role === 'toolResult' &&
    typeof value.toolCallId === 'string' &&
    typeof value.toolName === 'string' &&
    Array.isArray(value.content) &&
    typeof value.isError === 'boolean'
  )
}

export function getPiAssistantStopReason(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isPiRuntimeAssistantMessage(message)) {
      continue
    }

    return message.stopReason ?? null
  }

  return null
}

export function extractPiAssistantTerminalError(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isPiRuntimeAssistantMessage(message)) {
      continue
    }

    if (message.stopReason === 'error') {
      return message.errorMessage ?? `Pi assistant run ended with ${message.stopReason}.`
    }

    return null
  }

  return null
}

export function buildPiRunNewMessages(
  payload: PiPersistablePayload,
  appendedMessages: readonly unknown[],
): Message[] {
  const filteredAppended = appendedMessages.filter(
    (message): message is PiRuntimeAssistantMessage | PiRuntimeToolResultMessage =>
      isPiRuntimeAssistantMessage(message) || isPiRuntimeToolResultMessage(message),
  )

  const assistantAndToolMessages = piHistoryToProjectedMessages(filteredAppended)
  return [makeMessage('user', buildPersistedUserMessageParts(payload)), ...assistantAndToolMessages]
}

export function buildPiRunAssistantMessages(appendedMessages: readonly unknown[]): Message[] {
  const filteredAppended = appendedMessages.filter(
    (message): message is PiRuntimeAssistantMessage | PiRuntimeToolResultMessage =>
      isPiRuntimeAssistantMessage(message) || isPiRuntimeToolResultMessage(message),
  )

  return piHistoryToProjectedMessages(filteredAppended)
}
