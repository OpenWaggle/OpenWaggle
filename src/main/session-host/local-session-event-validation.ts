import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { worktreeLaunchProgressSchema } from '@shared/schemas/background-run'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEventCursor(value: Record<string, unknown>) {
  return typeof value.hostInstanceId === 'string' && typeof value.sequence === 'number'
}

const SESSION_LIST_CHANGES = new Set(['created', 'updated', 'archived', 'unarchived', 'deleted'])
const RUN_MODES = new Set(['classic', 'waggle'])
const worktreeLaunchEventSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('progress'), progress: worktreeLaunchProgressSchema }),
  Schema.Struct({ type: Schema.Literal('failure'), errorMessage: Schema.String }),
)

function isWorktreeLaunchEvent(value: unknown) {
  try {
    decodeUnknownExactOrThrow(worktreeLaunchEventSchema, value)
    return true
  } catch {
    return false
  }
}

const sessionEventValidators: Readonly<
  Record<string, (value: Record<string, unknown>) => boolean>
> = {
  'session-transport': (value) => isRecord(value.event),
  'session-worktree-launch': (value) =>
    typeof value.model === 'string' &&
    typeof value.mode === 'string' &&
    RUN_MODES.has(value.mode) &&
    isWorktreeLaunchEvent(value.event),
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
