import { Schema, type SchemaType } from '@shared/schema'
import { anyObjectSchema } from '@shared/schemas/lenient'
import { randomUUID } from 'node:crypto'
import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { isRecord } from '@shared/utils/validation'
import { piToolResultDetails } from './pi-tool-result-details'

function makeProjectedMessage(
  role: 'user' | 'assistant' | 'system',
  parts: MessagePart[],
  model?: string,
) {
  const message: Message = {
    id: MessageId(randomUUID()),
    role,
    parts,
    ...(model ? { model: SupportedModelId(model) } : {}),
    createdAt: Date.now(),
  }
  return message
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

  // JSON has no value for these, so they keep their text.
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return value.toString()
  }
  // Every other type returned above.
  return 'undefined'
}

export function toJsonObject(value: unknown) {
  if (!isRecord(value)) {
    const object: JsonObject = {}
    return object
  }

  const object: JsonObject = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry)]),
  )
  return object
}

function toToolResultArgs(details: unknown, fallbackArgs: JsonObject | undefined) {
  if (!isRecord(details)) {
    return fallbackArgs ?? {}
  }

  const args = toJsonObject(piToolResultDetails(details).args)
  return Object.keys(args).length > 0 ? args : (fallbackArgs ?? {})
}

function toToolResultDuration(details: unknown) {
  return piToolResultDetails(details).duration ?? 0
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

const isPiTextContent = Schema.is(
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
)
const isPiThinkingContent = Schema.is(
  Schema.Struct({ type: Schema.Literal('thinking'), thinking: Schema.String }),
)
const piToolCallContentSchema = Schema.Struct({
  type: Schema.Literal('toolCall'),
  id: Schema.String,
  name: Schema.String,
  arguments: anyObjectSchema,
})
const isPiToolCallContent = Schema.is(piToolCallContentSchema)

type PiToolCallContent = SchemaType<typeof piToolCallContentSchema>

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

function projectAssistantPart(part: unknown, toolCallArgs: Map<string, JsonObject>) {
  if (isPiTextContent(part)) {
    const result: MessagePart | null = { type: 'text', text: part.text }
    return result
  }
  if (isPiThinkingContent(part)) {
    const result: MessagePart | null = { type: 'reasoning', text: part.thinking }
    return result
  }
  const result: MessagePart | null = isPiToolCallContent(part)
    ? projectToolCallPart(part, toolCallArgs)
    : null
  return result
}

function projectToolCallPart(part: PiToolCallContent, toolCallArgs: Map<string, JsonObject>) {
  const toolArgs = toJsonObject(part.arguments)
  toolCallArgs.set(part.id, toolArgs)
  const result: MessagePart = {
    type: 'tool-call',
    toolCall: {
      id: ToolCallId(part.id),
      name: part.name,
      args: toolArgs,
      state: 'input-complete',
    },
  }
  return result
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
) {
  const part: MessagePart = {
    type: 'tool-result',
    toolResult: {
      id: ToolCallId(message.toolCallId ?? randomUUID()),
      name: message.toolName ?? 'unknown',
      args: toToolResultArgs(message.details, fallbackArgs),
      result: Array.isArray(message.content)
        ? toProjectedToolResultValue(message.content, message.details)
        : '',
      isError: message.isError,
      duration: toToolResultDuration(message.details),
      details: toJsonValue(message.details ?? null),
    },
  }
  return part
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

export function piHistoryToProjectedMessages(messages: readonly PiProjectedHistoryMessage[]) {
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

export function createStreamingMessageId() {
  const result: string = randomUUID()
  return result
}
