import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { agentTransportUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import { worktreeLaunchProgressSchema } from '@shared/schemas/background-run'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import { THINKING_LEVELS } from '@shared/types/settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEventCursor(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SessionHostEventCursor {
  return typeof value.hostInstanceId === 'string' && typeof value.sequence === 'number'
}

const SESSION_LIST_CHANGES = new Set(['created', 'updated', 'archived', 'unarchived', 'deleted'])
const RUN_MODES = new Set(['classic', 'waggle'])
const worktreeLaunchEventSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('progress'), progress: worktreeLaunchProgressSchema }),
  Schema.Struct({ type: Schema.Literal('failure'), errorMessage: Schema.String }),
)

function decodes(schema: Schema.Schema.AnyNoContext, value: unknown) {
  try {
    decodeUnknownExactOrThrow(schema, value)
    return true
  } catch {
    return false
  }
}

/** A transport event; a user message it carries must be display content, never model input. */
function isTransportEvent(value: unknown) {
  if (!isRecord(value)) return false
  if (value.type !== 'message_start' || value.userMessage === undefined) return true
  return value.role === 'user' && decodes(agentTransportUserMessageSchema, value.userMessage)
}

function isWorktreeLaunchEvent(value: unknown) {
  return decodes(worktreeLaunchEventSchema, value)
}

const sessionEventValidators: Readonly<
  Record<string, (value: Record<string, unknown>) => boolean>
> = {
  'session-transport': (value) => isTransportEvent(value.event),
  'session-worktree-launch': (value) =>
    typeof value.model === 'string' &&
    typeof value.mode === 'string' &&
    RUN_MODES.has(value.mode) &&
    isWorktreeLaunchEvent(value.event),
  'session-waggle-transport': (value) => isTransportEvent(value.event) && isRecord(value.meta),
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
  if (value.kind === 'default-thinking-level-changed') {
    return THINKING_LEVELS.some((level) => level === value.level)
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

const TRANSPORT_EVENT_KINDS = new Set(['session-transport', 'session-waggle-transport'])

/** The envelope with its transport event's user message left out, when it carries one. */
function withoutUserMessage(envelope: Record<string, unknown>) {
  const payload = envelope.payload
  if (!isRecord(payload) || !TRANSPORT_EVENT_KINDS.has(String(payload.kind))) return undefined
  const event = payload.event
  if (!isRecord(event) || event.type !== 'message_start' || event.userMessage === undefined) {
    return undefined
  }
  const { userMessage: _userMessage, ...rest } = event
  return { ...envelope, payload: { ...payload, event: rest } }
}

export type SessionHostEventDecision =
  | {
      readonly action: 'relay'
      readonly envelope: SessionHostEventEnvelope
      /** Its user message could not be decoded; the renderer places it from the Session detail. */
      readonly droppedUserMessage: boolean
    }
  | { readonly action: 'skip'; readonly cursor: SessionHostEventCursor }
  | { readonly action: 'invalid' }

/**
 * What a subscription does with one event frame.
 *
 * An event this client cannot decode is skipped past its cursor rather than failing the
 * subscription: a failed subscription resubscribes after the same cursor, gets the same event
 * again, and every Session's live events stop for as long as the Host can replay it. A user message
 * that does not decode costs only itself. Only an event without a cursor fails the subscription,
 * since nothing says where to resume.
 */
export function decideSessionHostEvent(value: unknown): SessionHostEventDecision {
  if (isSessionHostEventEnvelope(value)) {
    return { action: 'relay', envelope: value, droppedUserMessage: false }
  }
  if (!isRecord(value) || !isRecord(value.cursor) || !isEventCursor(value.cursor)) {
    return { action: 'invalid' }
  }
  const withoutMessage = withoutUserMessage(value)
  if (withoutMessage && isSessionHostEventEnvelope(withoutMessage)) {
    return { action: 'relay', envelope: withoutMessage, droppedUserMessage: true }
  }
  return {
    action: 'skip',
    cursor: { hostInstanceId: value.cursor.hostInstanceId, sequence: value.cursor.sequence },
  }
}
