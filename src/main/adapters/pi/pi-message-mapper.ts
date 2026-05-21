import { randomUUID } from 'node:crypto'
import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { isRecord } from '@shared/utils/validation'

function makeProjectedMessage(
  role: 'user' | 'assistant' | 'system',
  parts: MessagePart[],
  model?: string,
) {
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

function toToolResultArgs(details: unknown, fallbackArgs: JsonObject | undefined) {
  if (!isRecord(details)) {
    return fallbackArgs ?? {}
  }

  const args = toJsonObject(details.args)
  return Object.keys(args).length > 0 ? args : (fallbackArgs ?? {})
}

function toToolResultDuration(details: unknown) {
  return isRecord(details) && typeof details.duration === 'number' ? details.duration : 0
}

function toProjectedToolResultValue(content: readonly unknown[], details: unknown) {
  return {
    content: toJsonValue(content),
    details: toJsonValue(details ?? null),
  }
}

type PiProjectedHistoryMessage =
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

interface PiProjectionState {
  readonly result: Message[]
  currentAssistantParts: MessagePart[] | null
  currentAssistantModel: string | undefined
  currentToolCallArgs: Map<string, JsonObject>
}

interface PiToolCallContent {
  readonly type: 'toolCall'
  readonly id: string
  readonly name: string
  readonly arguments: JsonObject
}

function flushAssistant(state: PiProjectionState) {
  if (!state.currentAssistantParts) {
    return
  }
  state.result.push(
    makeProjectedMessage(
      'assistant',
      state.currentAssistantParts.length > 0
        ? state.currentAssistantParts
        : [{ type: 'text', text: '' }],
      state.currentAssistantModel,
    ),
  )
  state.currentAssistantParts = null
  state.currentAssistantModel = undefined
  state.currentToolCallArgs = new Map<string, JsonObject>()
}

function projectAssistantPart(
  part: unknown,
  toolCallArgs: Map<string, JsonObject>,
): MessagePart | null {
  if (!isRecord(part) || typeof part.type !== 'string') {
    return null
  }
  if (part.type === 'text' && typeof part.text === 'string') {
    return { type: 'text', text: part.text }
  }
  if (part.type === 'thinking' && typeof part.thinking === 'string') {
    return { type: 'reasoning', text: part.thinking }
  }
  return isPiToolCallContent(part) ? projectToolCallPart(part, toolCallArgs) : null
}

function isPiToolCallContent(part: unknown): part is PiToolCallContent {
  return (
    isRecord(part) &&
    part.type === 'toolCall' &&
    typeof part.id === 'string' &&
    typeof part.name === 'string' &&
    isRecord(part.arguments)
  )
}

function projectToolCallPart(
  part: PiToolCallContent,
  toolCallArgs: Map<string, JsonObject>,
): MessagePart {
  const toolArgs = toJsonObject(part.arguments)
  toolCallArgs.set(part.id, toolArgs)
  return {
    type: 'tool-call',
    toolCall: {
      id: ToolCallId(part.id),
      name: part.name,
      args: toolArgs,
      state: 'input-complete',
    },
  }
}

function projectAssistantParts(content: readonly unknown[], toolCallArgs: Map<string, JsonObject>) {
  return content.flatMap((part) => {
    const projected = projectAssistantPart(part, toolCallArgs)
    return projected ? [projected] : []
  })
}

function handleAssistantMessage(
  state: PiProjectionState,
  message: Extract<PiProjectedHistoryMessage, { role: 'assistant' }>,
) {
  flushAssistant(state)
  state.currentAssistantParts = projectAssistantParts(message.content, state.currentToolCallArgs)
  state.currentAssistantModel = message.model
}

function projectToolResultPart(
  message: Extract<PiProjectedHistoryMessage, { role: 'toolResult' }>,
  fallbackArgs: JsonObject | undefined,
): MessagePart {
  return {
    type: 'tool-result',
    toolResult: {
      id: ToolCallId(message.toolCallId ?? randomUUID()),
      name: message.toolName ?? 'unknown',
      args: toToolResultArgs(message.details, fallbackArgs),
      result: Array.isArray(message.content)
        ? toProjectedToolResultValue(message.content, message.details)
        : '',
      isError: message.isError === true,
      duration: toToolResultDuration(message.details),
      details: toJsonValue(message.details ?? null),
    },
  }
}

function handleToolResultMessage(
  state: PiProjectionState,
  message: Extract<PiProjectedHistoryMessage, { role: 'toolResult' }>,
) {
  if (!state.currentAssistantParts) {
    state.currentAssistantParts = []
  }
  state.currentAssistantParts = [
    ...state.currentAssistantParts,
    projectToolResultPart(message, state.currentToolCallArgs.get(message.toolCallId)),
  ]
}

export function piHistoryToProjectedMessages(
  messages: ReadonlyArray<PiProjectedHistoryMessage>,
): Message[] {
  const state: PiProjectionState = {
    result: [],
    currentAssistantParts: null,
    currentAssistantModel: undefined,
    currentToolCallArgs: new Map<string, JsonObject>(),
  }

  for (const message of messages) {
    if (message.role === 'assistant') {
      handleAssistantMessage(state, message)
      continue
    }

    handleToolResultMessage(state, message)
  }

  flushAssistant(state)
  return state.result
}

export function createStreamingMessageId(): string {
  return randomUUID()
}
