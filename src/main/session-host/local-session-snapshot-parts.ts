import { decodeUnknownExactOrThrow, getParseIssuePaths, Schema } from '@shared/schema'
import { nestedToolCallsSchema } from '@shared/schemas/nested-tool-calls'
import { browserPreviewAttachmentSchema, jsonValueSchema } from '@shared/schemas/validation'
import type { MessagePart } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { ToolCallId } from '@shared/types/brand'
import { createLogger } from '../logger'
import { describeError } from '../utils/describe-error'
import { isRecord } from './local-session-client-connection'

const logger = createLogger('session-host/run-snapshots')
const MAX_REPORTED_ISSUES = 5

/** The Run a snapshot belongs to, for the log line of anything dropped from it. */
export interface SnapshotContext {
  readonly sessionId: string
  readonly runId?: string
}

/**
 * Logs what a snapshot lost to a decode failure. A field the Host sends and this client does not
 * know costs the Run that field on reconnect, not the subscription every Session's live events
 * travel on: failing the whole snapshot left all Sessions on "Connecting" (#303 `nestedCalls`).
 */
export function reportUndecodable(
  context: SnapshotContext,
  what: string,
  error: unknown,
  details: object = {},
) {
  logger.error(`Dropped ${what} from an active Run snapshot this client cannot decode`, {
    sessionId: context.sessionId,
    ...(context.runId ? { runId: context.runId } : {}),
    ...details,
    // Where the decode failed, never the values: a part holds transcript and tool content.
    issues: getParseIssuePaths(error)?.slice(0, MAX_REPORTED_ISSUES) ?? [describeError(error)],
  })
}

/** A part's size as the frame carried it; it came from JSON, so it serialises back. */
function byteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
}

const jsonObjectSchema = Schema.Record({ key: Schema.String, value: jsonValueSchema })
/**
 * `MessagePart` as an active Run snapshot carries it. The decode is exact, so every field the Host
 * buffer can put on a part must be listed; `local-session-snapshot-parts.unit.test.ts` holds
 * the keys of each member to `MessagePart`'s.
 */
export const messagePartSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('text', 'reasoning'),
    text: Schema.String,
    contentIndex: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    type: Schema.Literal('attachment'),
    attachment: Schema.Struct({
      id: Schema.String,
      kind: Schema.Literal('text', 'image', 'pdf'),
      origin: Schema.optional(
        Schema.Literal('user-file', 'auto-paste-text', 'browser-preview', 'session-resource'),
      ),
      name: Schema.String,
      path: Schema.String,
      mimeType: Schema.String,
      sizeBytes: Schema.Number,
      contentSha256: Schema.optional(Schema.String),
      extractedText: Schema.String,
      browserPreview: Schema.optional(browserPreviewAttachmentSchema),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('tool-call'),
    toolCall: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      args: jsonObjectSchema,
      state: Schema.optional(Schema.Literal('input-complete')),
      // The live record of a codemode call's nested calls. A snapshot that carried one used to
      // fail to decode, which failed the whole subscription and left every Session's transcript
      // without live events while its Runs went on in the Host.
      nestedCalls: Schema.optional(nestedToolCallsSchema),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('tool-result'),
    toolResult: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      args: jsonObjectSchema,
      result: jsonValueSchema,
      isError: Schema.Boolean,
      duration: Schema.Number,
      details: Schema.optional(jsonValueSchema),
      nestedCalls: Schema.optional(nestedToolCallsSchema),
    }),
  }),
)

function decodeMessagePart(value: unknown): MessagePart {
  const part = decodeUnknownExactOrThrow(messagePartSchema, value)
  if (part.type === 'tool-call') {
    return { ...part, toolCall: { ...part.toolCall, id: ToolCallId(part.toolCall.id) } }
  }
  if (part.type === 'tool-result') {
    return { ...part, toolResult: { ...part.toolResult, id: ToolCallId(part.toolResult.id) } }
  }
  return part
}

/**
 * The Run's earlier assistant messages, from a Host that retains them. Fields a later Host adds to
 * one are not read. One that is malformed, or holds a part this client cannot decode, is left out,
 * as the Host leaves out one its caps cut short: the reconnect then shows the saved copy.
 */
export function decodeAssistantMessageSnapshots(
  value: unknown,
  context: SnapshotContext,
): Pick<BackgroundRunSnapshot, 'assistantMessages'> {
  if (value === undefined) return {}
  if (!Array.isArray(value)) {
    reportUndecodable(context, 'the earlier assistant messages', 'not an array')
    return {}
  }
  const assistantMessages = value.flatMap((candidate, messageIndex) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.messageId !== 'string' ||
      typeof candidate.timestamp !== 'number' ||
      !Array.isArray(candidate.parts)
    ) {
      reportUndecodable(context, 'an earlier assistant message', 'malformed message', {
        messageIndex,
      })
      return []
    }
    try {
      return [
        {
          messageId: candidate.messageId,
          timestamp: candidate.timestamp,
          parts: candidate.parts.map(decodeMessagePart),
        },
      ]
    } catch (error) {
      reportUndecodable(context, 'an earlier assistant message', error, {
        messageId: candidate.messageId,
      })
      return []
    }
  })
  return assistantMessages.length > 0 ? { assistantMessages } : {}
}

/**
 * The streaming message's parts. One this client cannot decode is left out and counted as
 * omitted, and the message is marked cut short, so the renderer does not take the remaining parts
 * for the whole message over a longer copy it already shows.
 */
export function decodeStreamingParts(
  candidate: { readonly parts: readonly unknown[]; readonly messageId?: string },
  context: SnapshotContext,
) {
  const parts: MessagePart[] = []
  let omittedBytes = 0
  candidate.parts.forEach((part, partIndex) => {
    try {
      parts.push(decodeMessagePart(part))
    } catch (error) {
      omittedBytes += byteLength(part)
      reportUndecodable(context, 'a streaming message part', error, {
        ...(candidate.messageId ? { messageId: candidate.messageId } : {}),
        partIndex,
        partType: isRecord(part) && typeof part.type === 'string' ? part.type : null,
      })
    }
  })
  return { parts, omittedBytes, dropped: parts.length < candidate.parts.length }
}

export function withUndecodableParts(
  degraded: BackgroundRunSnapshot['degraded'],
  streaming: ReturnType<typeof decodeStreamingParts>,
): BackgroundRunSnapshot['degraded'] {
  if (!streaming.dropped) return degraded
  return {
    reason: 'content-limit',
    ...degraded,
    omittedBytes: (degraded?.omittedBytes ?? 0) + streaming.omittedBytes,
    messageCutShort: true,
  }
}
