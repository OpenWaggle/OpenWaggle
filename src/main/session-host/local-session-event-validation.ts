import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEventCursor(value: Record<string, unknown>) {
  return typeof value.hostInstanceId === 'string' && typeof value.sequence === 'number'
}

const SESSION_LIST_CHANGES = new Set(['created', 'updated', 'archived', 'unarchived', 'deleted'])

const sessionEventValidators: Readonly<
  Record<string, (value: Record<string, unknown>) => boolean>
> = {
  'session-transport': (value) => isRecord(value.event),
  'session-waggle-transport': (value) => isRecord(value.event) && isRecord(value.meta),
  'session-waggle-turn': (value) => isRecord(value.event),
  'session-export-changed': (value) =>
    typeof value.exportOperationId === 'string' &&
    typeof value.status === 'string' &&
    isRecord(value.progress),
  'session-state-changed': (value) =>
    typeof value.stateRevision === 'number' && typeof value.operation === 'string',
  'session-list-changed': (value) =>
    typeof value.change === 'string' && SESSION_LIST_CHANGES.has(value.change),
}

function isEventPayload(value: Record<string, unknown>) {
  if (value.kind === 'semantic-discovery-readiness-changed') {
    return isRecord(value.readiness) && typeof value.readiness.status === 'string'
  }
  if (typeof value.kind !== 'string' || typeof value.sessionId !== 'string') return false
  return sessionEventValidators[value.kind]?.(value) ?? false
}

export function isSessionHostEventEnvelope(value: unknown): value is SessionHostEventEnvelope {
  return (
    isRecord(value) &&
    isRecord(value.cursor) &&
    isEventCursor(value.cursor) &&
    typeof value.timestamp === 'number' &&
    isRecord(value.payload) &&
    isEventPayload(value.payload)
  )
}
