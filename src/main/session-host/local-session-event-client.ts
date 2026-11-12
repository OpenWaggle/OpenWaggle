import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { sessionHostEventCursorSchema } from '@shared/schemas/session-host-event-cursor'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import { createLogger } from '../logger'
import { decodeActiveRunSnapshots } from './local-session-active-run-snapshots'
import {
  type LocalSessionClientConnectionInput,
  type LocalSessionFrameReader,
  openLocalSessionConnection,
  writeLocalSessionFrame,
} from './local-session-client-connection'
import { localSessionClientProtocolError } from './local-session-client-protocol-error'
import { decideSessionHostEvent } from './local-session-event-validation'

const logger = createLogger('session-host/event-client')

/** The frame fields this client reads; each one's value is decoded where it is used. */
const serverFrameFieldsSchema = Schema.Struct({
  kind: Schema.String,
  requestId: Schema.optionalWith(Schema.Unknown, { exact: true }),
  subscriptionId: Schema.optionalWith(Schema.Unknown, { exact: true }),
  cursor: Schema.optionalWith(Schema.Unknown, { exact: true }),
  activeRuns: Schema.optionalWith(Schema.Unknown, { exact: true }),
  event: Schema.optionalWith(Schema.Unknown, { exact: true }),
  reason: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

type ServerFrameFields = SchemaType<typeof serverFrameFieldsSchema>

const resyncRequiredFrameSchema = Schema.Struct({
  reason: Schema.Literal('host-restarted', 'cursor-expired', 'cursor-ahead', 'slow-consumer'),
  cursor: sessionHostEventCursorSchema,
})

const describedEventSchema = Schema.Struct({
  payload: Schema.Struct({
    kind: Schema.optionalWith(Schema.Unknown, { exact: true }),
    sessionId: Schema.optionalWith(Schema.Unknown, { exact: true }),
    event: Schema.optionalWith(Schema.Unknown, { exact: true }),
  }),
})

const describedTransportEventSchema = Schema.Struct({
  type: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

/** What the log may say about an event: never its content. */
function describeEventFrame(event: unknown) {
  if (!Schema.is(describedEventSchema)(event)) return {}
  const { kind, sessionId } = event.payload
  const transport = Schema.is(describedTransportEventSchema)(event.payload.event)
    ? event.payload.event.type
    : undefined
  return {
    ...(typeof kind === 'string' ? { kind } : {}),
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
    ...(typeof transport === 'string' ? { eventType: transport } : {}),
  }
}

export type LocalSessionWatchResult =
  | { readonly status: 'closed' }
  | {
      readonly status: 'resync-required'
      readonly reason: 'host-restarted' | 'cursor-expired' | 'cursor-ahead' | 'slow-consumer'
      readonly cursor: SessionHostEventCursor
    }

export type LocalSessionWatchInput = LocalSessionClientConnectionInput & {
  readonly after?: SessionHostEventCursor
  readonly sessionIds?: readonly string[]
  readonly signal?: AbortSignal
  readonly onEvent: (event: SessionHostEventEnvelope) => void | Promise<void>
  readonly onCursor?: (cursor: SessionHostEventCursor) => void | Promise<void>
  readonly onSnapshot?: (activeRuns: readonly BackgroundRunSnapshot[]) => void | Promise<void>
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
    ...(input.sessionIds && input.sessionIds.length > 0
      ? { sessionIds: [...new Set(input.sessionIds)] }
      : {}),
  })
  const value = await reader.next(timeoutMs)
  if (!Schema.is(serverFrameFieldsSchema)(value)) {
    throw new Error('Local Session Host returned an invalid subscription frame.')
  }
  const first = value
  if (first.kind === 'resync-required') return decodeResyncRequired(first)
  if (first.kind === 'error') {
    throw localSessionClientProtocolError(first, 'Subscription failed.')
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
    cursor: decodeCursor(first.cursor, 'subscription cursor'),
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
    const result = await consumeSubscriptionFrame(frame, subscriptionId, input)
    if (result) return result
  }
  return { status: 'closed' }
}

async function consumeSubscriptionFrame(
  frame: unknown,
  subscriptionId: string,
  input: LocalSessionWatchInput,
): Promise<LocalSessionWatchResult | undefined> {
  if (!Schema.is(serverFrameFieldsSchema)(frame)) {
    throw new Error('Local Session Host returned an invalid event frame.')
  }
  if (frame.kind === 'event' && frame.subscriptionId === subscriptionId) {
    await consumeEvent(frame.event, input)
    return
  }
  if (frame.kind === 'cursor-advanced' && frame.subscriptionId === subscriptionId) {
    await consumeCursorAdvancement(frame.cursor, input)
    return
  }
  if (frame.kind === 'resync-required') return decodeResyncRequired(frame)
  if (frame.kind === 'subscription-closed') return { status: 'closed' }
  if (frame.kind === 'error') {
    throw localSessionClientProtocolError(frame, 'Subscription failed.')
  }
}

async function consumeEvent(event: unknown, input: LocalSessionWatchInput) {
  const decision = decideSessionHostEvent(event)
  if (decision.action === 'invalid') {
    throw new Error('Local Session Host returned an invalid event.')
  }
  if (decision.action === 'skip') {
    logger.error('Skipped a Session Host event this client cannot decode', {
      ...describeEventFrame(event),
      sequence: decision.cursor.sequence,
    })
    await input.onCursor?.(decision.cursor)
    return
  }
  if (decision.droppedUserMessage) {
    logger.error('Relayed a Session Host event without the user message it cannot decode', {
      ...describeEventFrame(event),
      sequence: decision.envelope.cursor.sequence,
    })
  }
  await input.onEvent(decision.envelope)
}

async function consumeCursorAdvancement(cursor: unknown, input: LocalSessionWatchInput) {
  await input.onCursor?.(decodeCursor(cursor, 'cursor advancement'))
}

function decodeCursor(value: unknown, label: string): SessionHostEventCursor {
  if (!Schema.is(sessionHostEventCursorSchema)(value)) {
    throw new Error(`Local Session Host returned an invalid ${label}.`)
  }
  return { hostInstanceId: value.hostInstanceId, sequence: value.sequence }
}

export async function watchLocalSessionEvents(
  input: LocalSessionWatchInput,
): Promise<LocalSessionWatchResult> {
  const { socket, reader, timeoutMs } = await openLocalSessionConnection(input)
  const abort = () => socket.destroy()
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) abort()
  try {
    const subscription = await establishSubscription(socket, reader, timeoutMs, input)
    if (subscription.status !== 'ready') return subscription
    if (subscription.activeRuns !== undefined) {
      await input.onSnapshot?.(subscription.activeRuns)
    }
    await input.onCursor?.(subscription.cursor)
    return await consumeSubscription(reader, subscription.subscriptionId, input)
  } catch (error) {
    if (input.signal?.aborted) return { status: 'closed' }
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abort)
    socket.destroy()
  }
}

function decodeResyncRequired(frame: ServerFrameFields): LocalSessionWatchResult {
  const decoded = safeDecodeUnknown(resyncRequiredFrameSchema, frame)
  if (!decoded.success) {
    throw new Error('Local Session Host returned an invalid resynchronization frame.')
  }
  return { status: 'resync-required', reason: decoded.data.reason, cursor: decoded.data.cursor }
}
