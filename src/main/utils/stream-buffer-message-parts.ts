import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonObjectOrEmpty(value: JsonValue | undefined): Readonly<JsonObject> {
  return isJsonObject(value) ? value : {}
}

export function appendTextPart(parts: readonly MessagePart[], delta: string): MessagePart[] {
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), { type: 'text', text: lastPart.text + delta }]
  }
  return [...parts, { type: 'text', text: delta }]
}

export function appendReasoningPart(parts: readonly MessagePart[], delta: string): MessagePart[] {
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'reasoning') {
    return [...parts.slice(0, -1), { type: 'reasoning', text: lastPart.text + delta }]
  }
  return [...parts, { type: 'reasoning', text: delta }]
}

function findToolCallPartIndex(parts: readonly MessagePart[], toolCallId: string) {
  return parts.findIndex(
    (part) => part.type === 'tool-call' && String(part.toolCall.id) === toolCallId,
  )
}

export function upsertToolCallPart(input: {
  readonly parts: readonly MessagePart[]
  readonly toolCallId: string
  readonly toolName?: string
  readonly args?: JsonValue
}): MessagePart[] {
  const index = findToolCallPartIndex(input.parts, input.toolCallId)
  const existingPart = index === -1 ? null : input.parts[index]
  const toolName =
    input.toolName || (existingPart?.type === 'tool-call' ? existingPart.toolCall.name : '')
  const toolCallPart: MessagePart = {
    type: 'tool-call',
    toolCall: {
      id: ToolCallId(input.toolCallId),
      name: toolName,
      args: jsonObjectOrEmpty(input.args),
      state: 'input-complete',
    },
  }
  if (index === -1) return [...input.parts, toolCallPart]
  return [...input.parts.slice(0, index), toolCallPart, ...input.parts.slice(index + 1)]
}

export function appendToolResultPart(input: {
  readonly parts: readonly MessagePart[]
  readonly toolCallId: string
  readonly toolName: string
  readonly args?: JsonValue
  readonly result: JsonValue
  readonly isError: boolean
}): MessagePart[] {
  const withoutPreviousResult = input.parts.filter(
    (part) => part.type !== 'tool-result' || String(part.toolResult.id) !== input.toolCallId,
  )
  return [
    ...withoutPreviousResult,
    {
      type: 'tool-result',
      toolResult: {
        id: ToolCallId(input.toolCallId),
        name: input.toolName,
        args: jsonObjectOrEmpty(input.args),
        result: input.result,
        isError: input.isError,
        duration: 0,
      },
    },
  ]
}
