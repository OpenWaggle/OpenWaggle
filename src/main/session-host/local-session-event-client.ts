import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import {
  isRecord,
  type LocalSessionClientConnectionInput,
  type LocalSessionFrameReader,
  openLocalSessionConnection,
  writeLocalSessionFrame,
} from './local-session-client-connection'
import { isSessionHostEventEnvelope } from './local-session-event-validation'

export type LocalSessionWatchResult =
  | { readonly status: 'closed' }
  | {
      readonly status: 'resync-required'
      readonly reason: 'host-restarted' | 'cursor-expired' | 'cursor-ahead' | 'slow-consumer'
      readonly cursor: SessionHostEventCursor
    }

export type LocalSessionWatchInput = LocalSessionClientConnectionInput & {
  readonly after?: SessionHostEventCursor
  readonly signal?: AbortSignal
  readonly onEvent: (event: SessionHostEventEnvelope) => void | Promise<void>
  readonly onCursor?: (cursor: SessionHostEventCursor) => void | Promise<void>
  readonly onSnapshot?: (activeRuns: readonly BackgroundRunSnapshot[]) => void | Promise<void>
}

function decodeActiveRunSnapshots(value: unknown): BackgroundRunSnapshot[] {
  if (!Array.isArray(value)) throw new Error('Local Session Host returned an invalid Run snapshot.')
  return value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.sessionId !== 'string' ||
      typeof candidate.model !== 'string' ||
      (candidate.mode !== 'classic' && candidate.mode !== 'waggle') ||
      typeof candidate.startedAt !== 'number' ||
      !Array.isArray(candidate.parts) ||
      (candidate.messageId !== undefined && typeof candidate.messageId !== 'string')
    ) {
      throw new Error('Local Session Host returned an invalid active Run snapshot.')
    }
    return {
      sessionId: SessionId(candidate.sessionId),
      model: SupportedModelId(candidate.model),
      mode: candidate.mode,
      startedAt: candidate.startedAt,
      ...(candidate.messageId ? { messageId: candidate.messageId } : {}),
      parts: candidate.parts.map(decodeMessagePart),
      ...(isRecord(candidate.degraded) &&
      candidate.degraded.reason === 'content-limit' &&
      typeof candidate.degraded.omittedBytes === 'number'
        ? {
            degraded: {
              reason: 'content-limit' as const,
              omittedBytes: candidate.degraded.omittedBytes,
            },
          }
        : {}),
    }
  })
}

const jsonObjectSchema = Schema.Record({ key: Schema.String, value: jsonValueSchema })
const messagePartSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('text', 'reasoning'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('attachment'),
    attachment: Schema.Struct({
      id: Schema.String,
      kind: Schema.Literal('text', 'image', 'pdf'),
      origin: Schema.optional(Schema.Literal('user-file', 'auto-paste-text')),
      name: Schema.String,
      path: Schema.String,
      mimeType: Schema.String,
      sizeBytes: Schema.Number,
      extractedText: Schema.String,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('tool-call'),
    toolCall: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      args: jsonObjectSchema,
      state: Schema.optional(Schema.Literal('input-complete')),
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
    }),
  }),
)

function decodeMessagePart(value: unknown) {
  const part = decodeUnknownExactOrThrow(messagePartSchema, value)
  if (part.type === 'tool-call') {
    return { ...part, toolCall: { ...part.toolCall, id: ToolCallId(part.toolCall.id) } }
  }
  if (part.type === 'tool-result') {
    return { ...part, toolResult: { ...part.toolResult, id: ToolCallId(part.toolResult.id) } }
  }
  return part
}

async function establishSubscription(
  socket: Socket,
  reader: LocalSessionFrameReader,
  timeoutMs: number,
  input: LocalSessionWatchInput,
) {
  const requestId = randomUUID()
  await writeLocalSessionFrame(socket, {
    kind: 'subscribe',
    requestId,
    ...(input.after ? { after: input.after } : {}),
  })
  const first = await reader.next(timeoutMs)
  if (!isRecord(first) || typeof first.kind !== 'string') {
    throw new Error('Local Session Host returned an invalid subscription frame.')
  }
  if (first.kind === 'resync-required') return decodeResyncRequired(first)
  if (first.kind === 'error') {
    throw new Error(typeof first.message === 'string' ? first.message : 'Subscription failed.')
  }
  if (first.kind !== 'subscribed' || first.requestId !== requestId) {
    throw new Error('Local Session Host returned an unexpected subscription response.')
  }
  if (typeof first.subscriptionId !== 'string') {
    throw new Error('Local Session Host omitted the subscription identity.')
  }
  return {
    status: 'ready' as const,
    subscriptionId: first.subscriptionId,
    ...(first.activeRuns === undefined
      ? {}
      : { activeRuns: decodeActiveRunSnapshots(first.activeRuns) }),
  }
}

async function consumeSubscription(
  reader: LocalSessionFrameReader,
  subscriptionId: string,
  input: LocalSessionWatchInput,
): Promise<LocalSessionWatchResult> {
  while (!input.signal?.aborted) {
    const frame = await reader.next()
    if (!isRecord(frame) || typeof frame.kind !== 'string') {
      throw new Error('Local Session Host returned an invalid event frame.')
    }
    if (frame.kind === 'event' && frame.subscriptionId === subscriptionId) {
      if (!isSessionHostEventEnvelope(frame.event)) {
        throw new Error('Local Session Host returned an invalid event.')
      }
      await input.onEvent(frame.event)
      continue
    }
    if (frame.kind === 'cursor-advanced' && frame.subscriptionId === subscriptionId) {
      if (
        !isRecord(frame.cursor) ||
        typeof frame.cursor.hostInstanceId !== 'string' ||
        typeof frame.cursor.sequence !== 'number'
      ) {
        throw new Error('Local Session Host returned an invalid cursor advancement.')
      }
      await input.onCursor?.({
        hostInstanceId: frame.cursor.hostInstanceId,
        sequence: frame.cursor.sequence,
      })
      continue
    }
    if (frame.kind === 'resync-required') return decodeResyncRequired(frame)
    if (frame.kind === 'subscription-closed') return { status: 'closed' }
    if (frame.kind === 'error') {
      throw new Error(typeof frame.message === 'string' ? frame.message : 'Subscription failed.')
    }
  }
  return { status: 'closed' }
}

export async function watchLocalSessionEvents(
  input: LocalSessionWatchInput,
): Promise<LocalSessionWatchResult> {
  const { socket, reader, timeoutMs } = await openLocalSessionConnection(input)
  const abort = () => socket.destroy()
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    const subscription = await establishSubscription(socket, reader, timeoutMs, input)
    if (subscription.status !== 'ready') return subscription
    if (subscription.activeRuns !== undefined) {
      await input.onSnapshot?.(subscription.activeRuns)
    }
    return await consumeSubscription(reader, subscription.subscriptionId, input)
  } catch (error) {
    if (input.signal?.aborted) return { status: 'closed' }
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abort)
    socket.destroy()
  }
}

function decodeResyncRequired(frame: Record<string, unknown>): LocalSessionWatchResult {
  const reasons = ['host-restarted', 'cursor-expired', 'cursor-ahead', 'slow-consumer'] as const
  if (
    typeof frame.reason !== 'string' ||
    !reasons.some((reason) => reason === frame.reason) ||
    !isRecord(frame.cursor) ||
    typeof frame.cursor.hostInstanceId !== 'string' ||
    typeof frame.cursor.sequence !== 'number'
  ) {
    throw new Error('Local Session Host returned an invalid resynchronization frame.')
  }
  const reason = reasons.find((candidate) => candidate === frame.reason)
  if (!reason) throw new Error('Local Session Host returned an invalid resynchronization reason.')
  return {
    status: 'resync-required',
    reason,
    cursor: {
      hostInstanceId: frame.cursor.hostInstanceId,
      sequence: frame.cursor.sequence,
    },
  }
}
