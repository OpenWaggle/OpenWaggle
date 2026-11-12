import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import { Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS } from '@shared/types/session-control-returned-steers'
import { THINKING_LEVELS } from '@shared/types/settings'
import { agentLoopResponseSchema } from './agent-loop-interaction'
import { sessionAttachmentIdsSchema } from './session-attachment'
import { sessionInputIdSchema, sessionInputTextSchema } from './session-input'
import { inlineVisualizationContextSchema } from './validation'
import { waggleInvocationSchema } from './waggle'

const queueRevisionSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

export const steeringInputSchema = Schema.Struct({
  text: sessionInputTextSchema,
  attachmentIds: sessionAttachmentIdsSchema,
  visualizationContext: Schema.optionalWith(inlineVisualizationContextSchema, { exact: true }),
})

const uniqueFollowUpIdsSchema = Schema.Array(sessionInputIdSchema).pipe(
  Schema.maxItems(MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS),
  Schema.filter(
    (followUpIds) =>
      new Set(followUpIds).size === followUpIds.length || 'Follow-up IDs must be unique.',
  ),
)

/**
 * Message content a caller submits: what a Follow-up message carries. It names no thinking level
 * or authorization; a Run uses the Session's settings when it starts.
 */
export const followUpInputSchema = Schema.Struct({
  ...steeringInputSchema.fields,
  waggle: Schema.optionalWith(waggleInvocationSchema, { exact: true }),
})

/**
 * Input of a command that may start a Run on an idle Session (`message`, `start`).
 *
 * `thinkingLevel` sets the Session thinking level for that Run and later ones, as if chosen in the
 * Session. It is accepted only when the command starts a Run on an idle Session; a `message` that
 * would be queued instead is refused with `thinking_level_requires_idle_session`.
 */
export const messageInputSchema = Schema.Struct({
  ...followUpInputSchema.fields,
  thinkingLevel: Schema.optionalWith(Schema.Literal(...THINKING_LEVELS), { exact: true }),
})

export const steerCommandSchema = Schema.Struct({
  operation: Schema.Literal('steer'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
  input: steeringInputSchema,
})

/**
 * Starts a Run when the Session is idle and its queue will not deliver on its own; otherwise it
 * queues a Follow-up. `runAuthorizationOverride` and `input.thinkingLevel` are allowed only when it
 * starts a Run; a message that would be queued with either is refused.
 */
export const messageCommandSchema = Schema.Struct({
  operation: Schema.Literal('message'),
  sessionId: sessionInputIdSchema,
  runAuthorizationOverride: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
  input: messageInputSchema,
})

export const startCommandSchema = Schema.Struct({
  operation: Schema.Literal('start'),
  sessionId: sessionInputIdSchema,
  runAuthorizationOverride: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
  interactionTimeoutMs: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
    { exact: true },
  ),
  input: messageInputSchema,
})

/** A Follow-up message never carries a thinking level or a Run authorization override. */
export const followUpCommandSchema = Schema.Struct({
  operation: Schema.Literal('follow-up'),
  sessionId: sessionInputIdSchema,
  input: followUpInputSchema,
})

/** Replacement acts on an active Run, so it carries no thinking level or authorization override. */
export const replaceCommandSchema = Schema.Struct({
  operation: Schema.Literal('replace'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
  input: followUpInputSchema,
})

export const interruptCommandSchema = Schema.Struct({
  operation: Schema.Literal('interrupt'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
})

export const interruptDescendantsCommandSchema = Schema.Struct({
  operation: Schema.Literal('interrupt-descendants'),
  sessionId: sessionInputIdSchema,
})

export const promoteCommandSchema = Schema.Struct({
  operation: Schema.Literal('promote'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
})

export const queueWithdrawCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-withdraw'),
  sessionId: sessionInputIdSchema,
  followUpIds: uniqueFollowUpIdsSchema,
})

export const queueReorderCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-reorder'),
  sessionId: sessionInputIdSchema,
  expectedQueueRevision: queueRevisionSchema,
  orderedFollowUpIds: uniqueFollowUpIdsSchema,
})

export const queuePauseCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-pause'),
  sessionId: sessionInputIdSchema,
  expectedQueueRevision: queueRevisionSchema,
})

export const queueResumeCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-resume'),
  sessionId: sessionInputIdSchema,
  expectedQueueRevision: queueRevisionSchema,
})

/**
 * Re-authors a needs-attention Follow-up (`profile_revoked`, `authority_changed`) as the calling
 * desktop user, so it can be delivered under the user's own authority. The Follow-up keeps its
 * content and position; its original author stays as `authorCallerId` for provenance. It carries
 * no Run authorization override. Desktop app only; revision-guarded like other queue changes.
 */
export const queueAdoptCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-adopt'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  expectedQueueRevision: queueRevisionSchema,
})

/** Asks the Host to hold one Follow-up for a Follow-up edit (desktop user only). */
export const queueEditBeginCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-edit-begin'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
})

/**
 * The replaceable part of a queued Follow-up: the fields a new Follow-up carries. A present
 * `waggle` or `visualizationContext` keeps or sets it; an omitted one removes it.
 */
export const followUpEditInputSchema = followUpInputSchema

/** Replaces a held Follow-up's intent snapshot in place and releases its hold. */
export const queueEditSaveCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-edit-save'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  holdId: sessionInputIdSchema,
  expectedQueueRevision: queueRevisionSchema,
  input: followUpEditInputSchema,
})

/** Releases a Follow-up edit hold without changing the Follow-up. Releasing a gone hold succeeds. */
export const queueEditCancelCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-edit-cancel'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  holdId: sessionInputIdSchema,
})

export const interactionResponseCommandSchema = Schema.Struct({
  operation: Schema.Literal('request-respond', 'approval-respond'),
  sessionId: sessionInputIdSchema,
  runId: sessionInputIdSchema,
  interactionId: sessionInputIdSchema,
  kind: Schema.Literal('confirm', 'select', 'input', 'editor', 'notify', 'custom'),
  response: agentLoopResponseSchema,
})

export const authorizationSetCommandSchema = Schema.Struct({
  operation: Schema.Literal('authorization-set'),
  sessionId: sessionInputIdSchema,
  authorizationMode: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
})

/** Names one Follow-up edit hold (ADR 0044). */
export const followUpEditHoldReferenceSchema = Schema.Struct({
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  holdId: sessionInputIdSchema,
})
