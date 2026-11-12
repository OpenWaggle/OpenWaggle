import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { agentTransportUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import { worktreeLaunchProgressSchema } from '@shared/schemas/background-run'
import { desktopNotificationSchema } from '@shared/schemas/desktop-notification'
import { sessionHostEventCursorSchema } from '@shared/schemas/session-host-event-cursor'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import { THINKING_LEVELS } from '@shared/types/settings'

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

const transportEventFieldsSchema = Schema.Struct({
  type: Schema.optionalWith(Schema.Unknown, { exact: true }),
  role: Schema.optionalWith(Schema.Unknown, { exact: true }),
  userMessage: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

/** A JSON object: not null and not an array, which `Schema.Object` would also accept. */
const recordObjectSchema = Schema.declare(
  (value: unknown): value is object =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
)

/** A transport event; a user message it carries must be display content, never model input. */
function isTransportEvent(value: unknown) {
  if (Array.isArray(value) || !Schema.is(transportEventFieldsSchema)(value)) return false
  if (value.type !== 'message_start' || value.userMessage === undefined) return true
  return value.role === 'user' && decodes(agentTransportUserMessageSchema, value.userMessage)
}

const transportEventSchema = Schema.declare((value: unknown): value is object =>
  isTransportEvent(value),
)
const worktreeLaunchEventExactSchema = Schema.declare((value: unknown): value is object =>
  decodes(worktreeLaunchEventSchema, value),
)
const desktopNotificationExactSchema = Schema.declare((value: unknown): value is object =>
  decodes(desktopNotificationSchema, value),
)

function sessionEvent<const Kind extends string, Fields extends Schema.Struct.Fields>(
  kind: Kind,
  fields: Fields,
) {
  return Schema.Struct({ kind: Schema.Literal(kind), sessionId: Schema.String, ...fields })
}

/**
 * The fields this client relies on, per event kind. The check leaves every other field of the
 * payload as the Host wrote it, so the envelope relays unchanged.
 */
const eventPayloadSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('semantic-discovery-readiness-changed'),
    readiness: Schema.Struct({ status: Schema.String }),
  }),
  Schema.Struct({
    kind: Schema.Literal('default-thinking-level-changed'),
    level: Schema.Literal(...THINKING_LEVELS),
  }),
  Schema.Struct({
    kind: Schema.Literal('desktop-notification-shown'),
    notification: desktopNotificationExactSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('desktop-notification-withdrawn'),
    notificationId: Schema.String,
    revision: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal('session-title-model-refused'),
    model: Schema.String,
    reason: Schema.String,
    retryAt: Schema.Number,
  }),
  sessionEvent('session-transport', { event: transportEventSchema }),
  sessionEvent('session-worktree-launch', {
    model: Schema.String,
    mode: Schema.Literal('classic', 'waggle'),
    event: worktreeLaunchEventExactSchema,
  }),
  sessionEvent('session-waggle-transport', {
    event: transportEventSchema,
    meta: recordObjectSchema,
  }),
  sessionEvent('session-waggle-turn', { event: recordObjectSchema }),
  sessionEvent('session-export-changed', {
    exportOperationId: Schema.String,
    status: Schema.String,
    progress: recordObjectSchema,
  }),
  sessionEvent('session-state-changed', {
    stateRevision: Schema.Number,
    operation: Schema.String,
  }),
  sessionEvent('session-list-changed', {
    change: Schema.Literal('created', 'updated', 'archived', 'unarchived', 'deleted'),
  }),
)

const eventEnvelopeSchema = Schema.Struct({
  cursor: sessionHostEventCursorSchema,
  timestamp: Schema.Number,
  payload: eventPayloadSchema,
})

export function isSessionHostEventEnvelope(value: unknown): value is SessionHostEventEnvelope {
  return Schema.is(eventEnvelopeSchema)(value)
}

const envelopeCursorSchema = Schema.Struct({ cursor: sessionHostEventCursorSchema })

const userMessageCarrierSchema = Schema.Struct({
  payload: Schema.Struct({
    kind: Schema.Literal('session-transport', 'session-waggle-transport'),
    event: Schema.Struct({ type: Schema.Literal('message_start'), userMessage: Schema.Unknown }),
  }),
})

/** The envelope with its transport event's user message left out, when it carries one. */
function withoutUserMessage(envelope: unknown) {
  if (!Schema.is(userMessageCarrierSchema)(envelope)) return undefined
  const { payload } = envelope
  if (payload.event.userMessage === undefined) return undefined
  const { userMessage: _userMessage, ...rest } = payload.event
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
  if (!Schema.is(envelopeCursorSchema)(value)) return { action: 'invalid' }
  const withoutMessage = withoutUserMessage(value)
  if (withoutMessage && isSessionHostEventEnvelope(withoutMessage)) {
    return { action: 'relay', envelope: withoutMessage, droppedUserMessage: true }
  }
  return {
    action: 'skip',
    cursor: { hostInstanceId: value.cursor.hostInstanceId, sequence: value.cursor.sequence },
  }
}
