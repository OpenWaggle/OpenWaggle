import { match, P } from '@diegogbrisa/ts-match'
import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { isRecord } from '@shared/utils/validation'
import { toJsonObject, toJsonValue } from '../pi-message-mapper'
import type { PiPromptInput } from '../pi-runtime-input'

function textMessagePart(text: string): MessagePart {
  return { type: 'text', text }
}

function emptyTextMessagePart(): MessagePart {
  return textMessagePart('')
}

function imageInputMessagePart(mimeType: string): MessagePart {
  return textMessagePart(`[Image input: ${mimeType}]`)
}

function piTextOrImageBlockToPart(block: unknown): MessagePart | null {
  return match(block)
    .with({ type: 'text', text: P.select('text', P.string) }, ({ text }) => textMessagePart(text))
    .with({ type: 'image', mimeType: P.select('mimeType', P.optional(P.string)) }, ({ mimeType }) =>
      imageInputMessagePart(mimeType ?? 'image'),
    )
    .with({ type: 'image' }, () => imageInputMessagePart('image'))
    .otherwise(() => null)
}

function nonEmptyMessageParts(parts: readonly MessagePart[]) {
  return parts.length > 0 ? [...parts] : [emptyTextMessagePart()]
}

export function piTextAndImageContentToParts(content: unknown) {
  if (typeof content === 'string') {
    return [textMessagePart(content)]
  }

  if (!Array.isArray(content)) {
    return [emptyTextMessagePart()]
  }

  const parts: MessagePart[] = []
  for (const block of content) {
    const part = piTextOrImageBlockToPart(block)
    if (part) {
      parts.push(part)
    }
  }

  return nonEmptyMessageParts(parts)
}

function assistantTextPart(text: string): MessagePart {
  return { type: 'text', text }
}

function assistantReasoningPart(thinking: string): MessagePart {
  return { type: 'reasoning', text: thinking }
}

function assistantToolCallPart(input: {
  readonly id: string
  readonly name: string
  readonly toolArguments: unknown
}): MessagePart {
  return {
    type: 'tool-call',
    toolCall: {
      id: ToolCallId(input.id),
      name: input.name,
      args: toJsonObject(input.toolArguments),
      state: 'input-complete',
    },
  }
}

function piAssistantBlockToPart(block: unknown): MessagePart | null {
  return match(block)
    .with({ type: 'text', text: P.select('text', P.string) }, ({ text }) => assistantTextPart(text))
    .with({ type: 'thinking', thinking: P.select('thinking', P.string) }, ({ thinking }) =>
      assistantReasoningPart(thinking),
    )
    .with(
      {
        type: 'toolCall',
        id: P.select('id', P.string),
        name: P.select('name', P.string),
        arguments: P.select('toolArguments', P.optional(P._)),
      },
      assistantToolCallPart,
    )
    .otherwise(() => null)
}

export function piAssistantContentToParts(content: readonly unknown[]) {
  const parts: MessagePart[] = []

  for (const block of content) {
    const part = piAssistantBlockToPart(block)
    if (part) {
      parts.push(part)
    }
  }

  return nonEmptyMessageParts(parts)
}

function getToolResultDuration(details: unknown) {
  if (!isRecord(details) || typeof details.duration !== 'number') {
    return 0
  }
  return details.duration
}

function getToolResultArgs(details: unknown): JsonObject {
  if (!isRecord(details)) {
    return {}
  }
  return toJsonObject(details.args)
}

export function piToolResultContentToPart(message: {
  readonly toolCallId: string
  readonly toolName: string
  readonly content: readonly unknown[]
  readonly isError: boolean
  readonly details?: unknown
}): MessagePart {
  const details = toJsonValue(message.details ?? null)
  return {
    type: 'tool-result',
    toolResult: {
      id: ToolCallId(message.toolCallId),
      name: message.toolName,
      args: getToolResultArgs(message.details),
      result: {
        content: toJsonValue(message.content),
        details,
      },
      isError: message.isError,
      duration: getToolResultDuration(message.details),
      details,
    },
  }
}

export function buildMessageNodeContentJson(parts: readonly MessagePart[], model: string | null) {
  return JSON.stringify({
    parts: [...parts],
    model,
  })
}

export function buildRawNodeContentJson(value: JsonValue) {
  return JSON.stringify(value)
}

export type PiCustomTextContent = {
  readonly type: 'text'
  readonly text: string
}

export type PiCustomContent = string | (PiCustomTextContent | PiPromptInput['images'][number])[]
