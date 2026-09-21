import { randomUUID } from 'node:crypto'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpEventKind,
  McpEventRecord,
  McpJsonValue,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { Clock, Effect, Ref } from 'effect'
import type {
  McpEventInboxState,
  RetainedMcpEvent,
  RuntimeStateContext,
} from './runtime-state-types'

type IncomingMcpEvent = { readonly kind: McpEventKind; readonly payload: McpJsonValue }
type RateDecision = 'accept' | 'report-overflow' | 'drop'

export function emptyMcpEventInboxState() {
  return {
    bySession: new Map(),
    sessionBytes: new Map(),
    insertionOrder: new Map(),
    retainedBytes: 0,
  } satisfies McpEventInboxState
}

export function makeMcpEventRateLimiter() {
  // MCP notification callbacks are synchronous, so the client cannot slow a
  // noisy server. Keep the first overflow visible and discard the rest.
  let startedAt = Number.NEGATIVE_INFINITY
  let accepted = 0
  let overflowReported = false
  return (receivedAt: number): RateDecision => {
    if (receivedAt < startedAt || receivedAt - startedAt >= MCP_CONFIG.EVENT_INBOX_RATE_WINDOW_MS) {
      startedAt = receivedAt
      accepted = 0
      overflowReported = false
    }
    if (accepted < MCP_CONFIG.MAX_EVENT_INBOX_EVENTS_PER_WINDOW) {
      accepted += 1
      return 'accept'
    }
    if (!overflowReported) {
      overflowReported = true
      return 'report-overflow'
    }
    return 'drop'
  }
}

function eventBytes(event: McpEventRecord) {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

function boundedEvent(event: McpEventRecord) {
  const bytes = eventBytes(event)
  if (bytes <= MCP_CONFIG.MAX_EVENT_INBOX_EVENT_BYTES) return { record: event, bytes }
  const truncated: McpEventRecord = {
    ...event,
    payload: {
      truncated: true,
      originalBytes: bytes,
      detail: 'MCP event exceeded the Event Inbox per-event byte limit.',
    },
  }
  const truncatedBytes = eventBytes(truncated)
  return truncatedBytes <= MCP_CONFIG.MAX_EVENT_INBOX_EVENT_BYTES
    ? { record: truncated, bytes: truncatedBytes }
    : undefined
}

function removeOldestSessionEvent(
  bySession: Map<string, readonly RetainedMcpEvent[]>,
  sessionBytes: Map<string, number>,
  insertionOrder: Map<string, { readonly sessionId: string; readonly bytes: number }>,
  sessionId: string,
) {
  const existing = bySession.get(sessionId)
  const oldest = existing?.[0]
  if (!oldest) return 0
  const remaining = existing.slice(1)
  insertionOrder.delete(oldest.record.id)
  if (remaining.length === 0) {
    bySession.delete(sessionId)
    sessionBytes.delete(sessionId)
  } else {
    bySession.set(sessionId, remaining)
    sessionBytes.set(sessionId, (sessionBytes.get(sessionId) ?? oldest.bytes) - oldest.bytes)
  }
  return oldest.bytes
}

function retainEvent(current: McpEventInboxState, retained: RetainedMcpEvent) {
  const bySession = new Map(current.bySession)
  const sessionBytes = new Map(current.sessionBytes)
  const insertionOrder = new Map(current.insertionOrder)
  const sessionId = retained.record.sessionId
  const existing = current.bySession.get(sessionId) ?? []
  bySession.set(sessionId, [...existing, retained])
  sessionBytes.set(sessionId, (current.sessionBytes.get(sessionId) ?? 0) + retained.bytes)
  insertionOrder.set(retained.record.id, { sessionId, bytes: retained.bytes })
  let retainedBytes = current.retainedBytes + retained.bytes

  while (
    (bySession.get(sessionId)?.length ?? 0) > MCP_CONFIG.MAX_EVENT_INBOX_ITEMS ||
    (sessionBytes.get(sessionId) ?? 0) > MCP_CONFIG.MAX_EVENT_INBOX_SESSION_BYTES
  ) {
    retainedBytes -= removeOldestSessionEvent(bySession, sessionBytes, insertionOrder, sessionId)
  }

  while (
    retainedBytes > MCP_CONFIG.MAX_EVENT_INBOX_GLOBAL_BYTES ||
    insertionOrder.size > MCP_CONFIG.MAX_EVENT_INBOX_GLOBAL_ITEMS
  ) {
    const oldest = insertionOrder.entries().next()
    if (oldest.done) break
    const [, metadata] = oldest.value
    retainedBytes -= removeOldestSessionEvent(
      bySession,
      sessionBytes,
      insertionOrder,
      metadata.sessionId,
    )
  }

  return { bySession, sessionBytes, insertionOrder, retainedBytes }
}

export function recordMcpEvent(
  ctx: RuntimeStateContext,
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
  event: IncomingMcpEvent,
  rateLimit: (receivedAt: number) => RateDecision,
) {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((receivedAt) =>
      Ref.update(ctx.events, (current) => {
        const decision = rateLimit(receivedAt)
        if (decision === 'drop') return current
        const next: McpEventRecord = {
          id: randomUUID(),
          sessionId: snapshot.sessionId,
          serverInstanceId: server.instanceId,
          serverLabel: server.name,
          kind: decision === 'accept' ? event.kind : 'server-log',
          receivedAt,
          payload:
            decision === 'accept'
              ? event.payload
              : {
                  dropped: true,
                  detail: 'MCP Event Inbox intake rate exceeded; later events were dropped.',
                },
          read: false,
        }
        const retained = boundedEvent(next)
        return retained ? retainEvent(current, retained) : current
      }),
    ),
  )
}

export function getRetainedMcpEvents(ctx: RuntimeStateContext, sessionId?: string | null) {
  return Ref.get(ctx.events).pipe(
    Effect.map((current) =>
      sessionId
        ? (current.bySession.get(sessionId) ?? []).map((entry) => entry.record)
        : [...current.bySession.values()].flatMap((events) => events.map((entry) => entry.record)),
    ),
  )
}

export function clearSessionEvents(ctx: RuntimeStateContext, sessionId: string) {
  return Ref.update(ctx.events, (current) => {
    const existing = current.bySession.get(sessionId)
    if (!existing) return current
    const bySession = new Map(current.bySession)
    const sessionBytes = new Map(current.sessionBytes)
    const insertionOrder = new Map(current.insertionOrder)
    let retainedBytes = current.retainedBytes
    for (const event of existing) {
      insertionOrder.delete(event.record.id)
      retainedBytes -= event.bytes
    }
    bySession.delete(sessionId)
    sessionBytes.delete(sessionId)
    return { bySession, sessionBytes, insertionOrder, retainedBytes }
  })
}
