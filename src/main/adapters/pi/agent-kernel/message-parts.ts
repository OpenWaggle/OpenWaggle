import { match, P } from '@diegogbrisa/ts-match'
import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { isRecord } from '@shared/utils/validation'
import { toJsonObject, toJsonValue } from '../pi-message-mapper'
import type { PiPromptInput } from '../pi-runtime-input'
import { stripAtomicVisualizationContext } from '../pi-runtime-input'

function textMessagePart(text: string): MessagePart {
  return { type: 'text', text }
}

function emptyTextMessagePart(): MessagePart {
  return textMessagePart('')
}

function piTextOrImageBlockToPart(block: unknown): MessagePart | null {
  return match(block)
    .with({ type: 'text', text: P.select('text', P.string) }, ({ text }) =>
      textMessagePart(stripAtomicVisualizationContext(text)),
    )
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

/**
 * Where the attachment blocks `buildAgentPromptText` appends begin: after the typed text and a
 * blank line (or at the start), a whole line `[Attachment: <name>]`, followed by the attachment's
 * extracted text on the next line or by nothing. Typed text that merely contains
 * `[Attachment: ` in a sentence is kept.
 *
 * Typed text that itself ends in such a line cannot be told apart: `buildAgentPromptText` makes
 * the same string for the text `A\n\n[Attachment: x]` with no attachments as for `A` with an
 * attachment `x` without extracted text, and this fallback runs exactly when no display
 * projection recorded the message's attachments. It strips from the first such line, which keeps
 * every message OpenWaggle sent with attachments readable.
 */
const SYNTHESIZED_ATTACHMENT_BLOCK = /(?:^|\n\n)\[Attachment: [^\n]*\](?=\n|$)/u

/** The typed text of a Pi user prompt, without the attachment blocks OpenWaggle appended to it. */
function withoutSynthesizedAttachments(part: MessagePart): MessagePart[] {
  if (part.type !== 'text') return [part]
  const marker = SYNTHESIZED_ATTACHMENT_BLOCK.exec(part.text)
  if (!marker) return [part]
  const text = part.text.slice(0, marker.index).trim()
  return text ? [textMessagePart(text)] : []
}

/**
 * The display parts of a Pi user message no display projection was recorded for. Pi's text is
 * model input, so the `[Attachment: …]` blocks synthesized from attachments are dropped with its
 * image payloads and visualization context; the live transcript and the snapshot both use this.
 */
export function piUserContentToDisplayParts(content: unknown) {
  return nonEmptyMessageParts(
    piTextAndImageContentToParts(content).flatMap(withoutSynthesizedAttachments),
  )
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
