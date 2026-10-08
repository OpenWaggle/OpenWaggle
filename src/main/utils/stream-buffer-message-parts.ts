import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonObjectOrEmpty(value: JsonValue | undefined): Readonly<JsonObject> {
  return isJsonObject(value) ? value : {}
}

/**
 * The part a text or reasoning delta of content block `contentIndex` goes to, as the renderer's
 * live view puts it (`chat-stream-state-helpers.ts`), or -1 for a new part: text continues the
 * last part when that is text; reasoning continues its own block's part, wherever it is. The two
 * must split an answer alike, or a reconnect cannot tell which of its parts a shown one is. Every
 * buffer part names its block: a replica is restored only from a Host of its own revision.
 */
export function textDeltaTargetIndex(
  parts: readonly MessagePart[],
  type: 'text' | 'reasoning',
  contentIndex: number,
) {
  const last = parts.at(-1)
  if (type === 'text') return last?.type === 'text' ? parts.length - 1 : -1
  return parts.findIndex((part) => part.type === 'reasoning' && part.contentIndex === contentIndex)
}

/** The parts with a text or reasoning delta appended where `textDeltaTargetIndex` puts it. */
export function appendTextDeltaPart(
  parts: readonly MessagePart[],
  type: 'text' | 'reasoning',
  delta: string,
  contentIndex: number,
): MessagePart[] {
  const index = textDeltaTargetIndex(parts, type, contentIndex)
  const target = parts[index]
  if (target?.type !== type) return [...parts, { type, text: delta, contentIndex }]
  return parts.map((part, partIndex) =>
    partIndex === index && part.type === type ? { ...part, text: part.text + delta } : part,
  )
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
