import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import { decodeActiveRunSnapshots } from './local-session-active-run-snapshots'
import {
  isRecord,
  type LocalSessionClientConnectionInput,
  type LocalSessionFrameReader,
  openLocalSessionConnection,
  writeLocalSessionFrame,
} from './local-session-client-connection'
import { localSessionClientProtocolError } from './local-session-client-protocol-error'
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
  const first = await reader.next(timeoutMs)
  if (!isRecord(first) || typeof first.kind !== 'string') {
    throw new Error('Local Session Host returned an invalid subscription frame.')
  }
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
  if (!isRecord(frame) || typeof frame.kind !== 'string') {
    throw new Error('Local Session Host returned an invalid event frame.')
  }
  if (frame.kind === 'event' && frame.subscriptionId === subscriptionId) {
    if (!isSessionHostEventEnvelope(frame.event)) {
      throw new Error('Local Session Host returned an invalid event.')
    }
    await input.onEvent(frame.event)
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

async function consumeCursorAdvancement(cursor: unknown, input: LocalSessionWatchInput) {
  await input.onCursor?.(decodeCursor(cursor, 'cursor advancement'))
}

function decodeCursor(value: unknown, label: string): SessionHostEventCursor {
  if (
    !isRecord(value) ||
    typeof value.hostInstanceId !== 'string' ||
    typeof value.sequence !== 'number'
  ) {
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
    cursor: decodeCursor(frame.cursor, 'resynchronization cursor'),
  }
}
