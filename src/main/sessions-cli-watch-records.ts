import {
  isSessionlessHostEvent,
  type SessionHostEventCursor,
  type SessionHostEventEnvelope,
  type SessionHostEventPayload,
  type SessionHostEventResyncReason,
} from '@shared/types/session-host-event'
import type { LocalSessionWatchResult } from './session-host/local-session-event-client'

/**
 * One `record` of `hive watch --jsonl` and `hive exports-watch --jsonl` (ADR 0063). Every record
 * names its `kind`; a consumer ignores a kind it does not know. `event.kind`, `event.sessionId`,
 * the cursor, the timestamp and the resync reasons are covered from 1.0. The bodies of
 * `session-transport` and `session-waggle-transport` events follow Pi and are not.
 */
export type SessionsCliWatchRecord =
  | { readonly kind: 'cursor'; readonly cursor: SessionHostEventCursor }
  | {
      readonly kind: 'event'
      readonly cursor: SessionHostEventCursor
      readonly timestamp: number
      readonly event: SessionHostEventPayload
    }
  | {
      readonly kind: 'resync-required'
      readonly reason: SessionHostEventResyncReason
      readonly cursor: SessionHostEventCursor
    }

/** The Session an event belongs to; Host-wide events belong to none. */
export function watchEventSessionId(envelope: SessionHostEventEnvelope) {
  return isSessionlessHostEvent(envelope.payload) ? undefined : envelope.payload.sessionId
}

export function watchCursorRecord(cursor: SessionHostEventCursor): SessionsCliWatchRecord {
  return { kind: 'cursor', cursor }
}

export function watchEventRecord(envelope: SessionHostEventEnvelope): SessionsCliWatchRecord {
  return {
    kind: 'event',
    cursor: envelope.cursor,
    timestamp: envelope.timestamp,
    event: envelope.payload,
  }
}

export function watchResyncRecord(
  result: Extract<LocalSessionWatchResult, { readonly status: 'resync-required' }>,
): SessionsCliWatchRecord {
  return { kind: 'resync-required', reason: result.reason, cursor: result.cursor }
}
