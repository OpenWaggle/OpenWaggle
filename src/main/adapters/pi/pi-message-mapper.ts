import { randomUUID } from 'node:crypto'
import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { isRecord } from '@shared/utils/validation'

function makeProjectedMessage(
  role: 'user' | 'assistant' | 'system',
  parts: MessagePart[],
  model?: string,
): Message {
  return {
    id: MessageId(randomUUID()),
    role,
    parts,
    model: model ? SupportedModelId(model) : undefined,
    createdAt: Date.now(),
  }
}

export function toJsonValue(value: unknown): JsonValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
    )
  }

  return String(value)
}

export function toJsonObject(value: unknown): JsonObject {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]))
}

function toToolResultArgs(details: unknown, fallbackArgs: JsonObject | undefined): JsonObject {
  if (!isRecord(details)) {
    return fallbackArgs ?? {}
  }

  const args = toJsonObject(details.args)
  return Object.keys(args).length > 0 ? args : (fallbackArgs ?? {})
}

function toToolResultDuration(details: unknown): number {
  return isRecord(details) && typeof details.duration === 'number' ? details.duration : 0
}

function toProjectedToolResultValue(content: readonly unknown[], details: unknown): JsonObject {
  return {
    content: toJsonValue(content),
    details: toJsonValue(details ?? null),
  }
}

export function piHistoryToProjectedMessages(
  messages: ReadonlyArray<
    | {
        readonly role: 'assistant'
        readonly content: readonly unknown[]
        readonly model: string
      }
    | {
        readonly role: 'toolResult'
        readonly content: readonly unknown[]
        readonly toolCallId: string
        readonly toolName: string
        readonly isError: boolean
        readonly details?: unknown
      }
  >,
): Message[] {
  const result: Message[] = []
  let currentAssistantParts: MessagePart[] | null = null
  let currentAssistantModel: string | undefined
  let currentToolCallArgs = new Map<string, JsonObject>()

  function flushAssistant(): void {
    if (!currentAssistantParts) {
      return
    }
    result.push(
      makeProjectedMessage(
        'assistant',
        currentAssistantParts.length > 0 ? currentAssistantParts : [{ type: 'text', text: '' }],
        currentAssistantModel,
      ),
    )
    currentAssistantParts = null
    currentAssistantModel = undefined
    currentToolCallArgs = new Map<string, JsonObject>()
  }

  for (const message of messages) {
    if (message.role === 'assistant') {
      flushAssistant()

      const parts: MessagePart[] = []
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (!isRecord(part) || typeof part.type !== 'string') {
            continue
          }

          if (part.type === 'text' && typeof part.text === 'string') {
            parts.push({ type: 'text', text: part.text })
            continue
          }

          if (part.type === 'thinking' && typeof part.thinking === 'string') {
            parts.push({ type: 'reasoning', text: part.thinking })
            continue
          }

          if (
            part.type === 'toolCall' &&
            typeof part.id === 'string' &&
            typeof part.name === 'string' &&
            isRecord(part.arguments)
          ) {
            const toolArgs = toJsonObject(part.arguments)
            currentToolCallArgs.set(part.id, toolArgs)
            parts.push({
              type: 'tool-call',
              toolCall: {
                id: ToolCallId(part.id),
                name: part.name,
                args: toolArgs,
                state: 'input-complete',
              },
            })
          }
        }
      }

      currentAssistantParts = parts
      currentAssistantModel = message.model
      continue
    }

    if (message.role === 'toolResult') {
      if (!currentAssistantParts) {
        currentAssistantParts = []
      }

      currentAssistantParts = [
        ...currentAssistantParts,
        {
          type: 'tool-result',
          toolResult: {
            id: ToolCallId(message.toolCallId ?? randomUUID()),
            name: message.toolName ?? 'unknown',
            args: toToolResultArgs(message.details, currentToolCallArgs.get(message.toolCallId)),
            result: Array.isArray(message.content)
              ? toProjectedToolResultValue(message.content, message.details)
              : '',
            isError: message.isError === true,
            duration: toToolResultDuration(message.details),
            details: toJsonValue(message.details ?? null),
          },
        },
      ]
    }
  }

  flushAssistant()
  return result
}

export function createStreamingMessageId(): string {
  return randomUUID()
}
