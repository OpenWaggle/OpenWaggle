import { match, P } from '@diegogbrisa/ts-match'
import type { MessagePart, TextPart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import type { NestedToolCallRecord, NestedToolCalls } from '@shared/types/tools'
import { toJsonObject, toJsonValue } from '../pi-message-mapper'
import type { PiPromptInput } from '../pi-runtime-input'
import { stripAtomicVisualizationContext } from '../pi-runtime-input'
import { piToolResultDetails } from '../pi-tool-result-details'

function textMessagePart(text: string) {
  const part: TextPart = { type: 'text', text }
  return part
}

function emptyTextMessagePart() {
  return textMessagePart('')
}

function piTextOrImageBlockToPart(block: unknown) {
  const part: TextPart | null = match(block)
    .with({ type: 'text', text: P.select('text', P.string) }, ({ text }) =>
      textMessagePart(stripAtomicVisualizationContext(text)),
    )
    .otherwise(() => null)
  return part
}

function nonEmptyMessageParts<Part extends MessagePart>(parts: readonly Part[]) {
  const result: (Part | TextPart)[] = parts.length > 0 ? [...parts] : [emptyTextMessagePart()]
  return result
}

export function piTextAndImageContentToParts(content: unknown) {
  if (typeof content === 'string') {
    return [textMessagePart(content)]
  }

  if (!Array.isArray(content)) {
    return [emptyTextMessagePart()]
  }

  const parts: TextPart[] = []
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
function withoutSynthesizedAttachments(part: TextPart) {
  const marker = SYNTHESIZED_ATTACHMENT_BLOCK.exec(part.text)
  if (!marker) {
    const result: TextPart[] = [part]
    return result
  }
  const text = part.text.slice(0, marker.index).trim()
  const result: TextPart[] = text ? [textMessagePart(text)] : []
  return result
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

function assistantTextPart(text: string) {
  const part: MessagePart = { type: 'text', text }
  return part
}

function assistantReasoningPart(thinking: string) {
  const part: MessagePart = { type: 'reasoning', text: thinking }
  return part
}

function assistantToolCallPart(input: {
  readonly id: string
  readonly name: string
  readonly toolArguments: unknown
}) {
  const part: MessagePart = {
    type: 'tool-call',
    toolCall: {
      id: ToolCallId(input.id),
      name: input.name,
      args: toJsonObject(input.toolArguments),
      state: 'input-complete',
    },
  }
  return part
}

function piAssistantBlockToPart(block: unknown) {
  const part: MessagePart | null = match(block)
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
  return part
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
  return piToolResultDetails(details).duration ?? 0
}

function getToolResultArgs(details: unknown) {
  return toJsonObject(piToolResultDetails(details).args)
}

interface PiNestedToolCallRecord {
  readonly id: string
  readonly name: string
  readonly arguments?: unknown
  readonly argumentsBytes?: number
  readonly status: NestedToolCallRecord['status']
  readonly durationMs?: number
  readonly error?: string
}

function nestedToolCallRecord(record: PiNestedToolCallRecord) {
  const result: NestedToolCallRecord = {
    id: record.id,
    name: record.name,
    ...(record.arguments !== undefined ? { args: toJsonObject(record.arguments) } : {}),
    ...(record.argumentsBytes !== undefined ? { argsBytes: record.argumentsBytes } : {}),
    status: record.status,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    ...(record.error !== undefined ? { error: record.error } : {}),
  }
  return result
}

/** Pi records the calls a tool made through `ctx.executeTool()` on its result as `nestedCalls`. */
function nestedToolCalls(nestedCalls: {
  readonly calls: readonly PiNestedToolCallRecord[]
  readonly complete: boolean
}) {
  const result: NestedToolCalls = {
    calls: nestedCalls.calls.map(nestedToolCallRecord),
    complete: nestedCalls.complete,
  }
  return result
}

export function piToolResultContentToPart(message: {
  readonly toolCallId: string
  readonly toolName: string
  readonly content: readonly unknown[]
  readonly isError: boolean
  readonly details?: unknown
  readonly nestedCalls?: {
    readonly calls: readonly PiNestedToolCallRecord[]
    readonly complete: boolean
  }
}) {
  const details = toJsonValue(message.details ?? null)
  const part: MessagePart = {
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
      ...(message.nestedCalls ? { nestedCalls: nestedToolCalls(message.nestedCalls) } : {}),
    },
  }
  return part
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

export interface PiCustomTextContent {
  readonly type: 'text'
  readonly text: string
}

export type PiCustomContent = string | (PiCustomTextContent | PiPromptInput['images'][number])[]
