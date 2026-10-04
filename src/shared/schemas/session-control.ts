import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS } from '@shared/types/session-control-returned-steers'
import { THINKING_LEVELS } from '@shared/types/settings'
import { agentLoopResponseSchema } from './agent-loop-interaction'
import { sessionAttachmentIdsSchema } from './session-attachment'
import {
  delegationAcceptCommandSchema,
  delegationAmendCommandSchema,
  delegationCancelCommandSchema,
  delegationClaimCommandSchema,
  delegationConflictAcknowledgeCommandSchema,
  delegationDependencyCommandSchema,
  delegationProposeAmendmentCommandSchema,
  delegationReopenCommandSchema,
  delegationRequestRevisionCommandSchema,
  delegationStateCommandSchema,
  delegationSubmitCommandSchema,
  delegationVerifyCommandSchema,
  reportCommandSchema,
} from './session-collaboration-control'
import { sessionControlMutationOutcomeSchema } from './session-control-outcomes'
import { exportCancelCommandSchema, exportCreateCommandSchema } from './session-export-operation'
import { sessionInputIdSchema, sessionInputTextSchema } from './session-input'
import { sessionOrganizationCommandSchemas } from './session-organization'
import { inlineVisualizationContextSchema } from './validation'
import { waggleInvocationSchema } from './waggle'

export { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
export { sessionControlMutationOutcomeSchema } from './session-control-outcomes'

const steeringInputSchema = Schema.Struct({
  text: sessionInputTextSchema,
  attachmentIds: sessionAttachmentIdsSchema,
  visualizationContext: Schema.optional(inlineVisualizationContextSchema),
})

const uniqueFollowUpIdsSchema = Schema.Array(sessionInputIdSchema).pipe(
  Schema.maxItems(MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS),
  Schema.filter(
    (followUpIds) =>
      new Set(followUpIds).size === followUpIds.length || 'Follow-up IDs must be unique.',
  ),
)

/** What a Follow-up message carries: content only, never a thinking level or authorization. */
const followUpInputSchema = Schema.Struct({
  ...steeringInputSchema.fields,
  waggle: Schema.optional(waggleInvocationSchema),
})

/** A Run-starting input may also set the Session thinking level (see `SessionControlMessageInput`). */
const messageInputSchema = Schema.Struct({
  ...followUpInputSchema.fields,
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
})

const steerCommandSchema = Schema.Struct({
  operation: Schema.Literal('steer'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
  input: steeringInputSchema,
})

const messageCommandSchema = Schema.Struct({
  operation: Schema.Literal('message'),
  sessionId: sessionInputIdSchema,
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  input: messageInputSchema,
})

const startCommandSchema = Schema.Struct({
  operation: Schema.Literal('start'),
  sessionId: sessionInputIdSchema,
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  interactionTimeoutMs: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
  ),
  input: messageInputSchema,
})

const followUpCommandSchema = Schema.Struct({
  operation: Schema.Literal('follow-up'),
  sessionId: sessionInputIdSchema,
  input: followUpInputSchema,
})

const replaceCommandSchema = Schema.Struct({
  operation: Schema.Literal('replace'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
  input: followUpInputSchema,
})

const interruptCommandSchema = Schema.Struct({
  operation: Schema.Literal('interrupt'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
})

const interruptDescendantsCommandSchema = Schema.Struct({
  operation: Schema.Literal('interrupt-descendants'),
  sessionId: sessionInputIdSchema,
})

const promoteCommandSchema = Schema.Struct({
  operation: Schema.Literal('promote'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
})

const queueWithdrawCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-withdraw'),
  sessionId: sessionInputIdSchema,
  followUpIds: uniqueFollowUpIdsSchema,
})

const queueReorderCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-reorder'),
  sessionId: sessionInputIdSchema,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  orderedFollowUpIds: uniqueFollowUpIdsSchema,
})

const queuePauseCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-pause'),
  sessionId: sessionInputIdSchema,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

const queueResumeCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-resume'),
  sessionId: sessionInputIdSchema,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

const queueAdoptCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-adopt'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

const queueEditBeginCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-edit-begin'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
})

/** A Follow-up edit carries the fields a new Follow-up carries. */
const followUpEditInputSchema = followUpInputSchema

const queueEditSaveCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-edit-save'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  holdId: sessionInputIdSchema,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  input: followUpEditInputSchema,
})

const queueEditCancelCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-edit-cancel'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  holdId: sessionInputIdSchema,
})

const interactionResponseCommandSchema = Schema.Struct({
  operation: Schema.Literal('request-respond', 'approval-respond'),
  sessionId: sessionInputIdSchema,
  runId: sessionInputIdSchema,
  interactionId: sessionInputIdSchema,
  kind: Schema.Literal('confirm', 'select', 'input', 'editor', 'notify', 'custom'),
  response: agentLoopResponseSchema,
})

const authorizationSetCommandSchema = Schema.Struct({
  operation: Schema.Literal('authorization-set'),
  sessionId: sessionInputIdSchema,
  authorizationMode: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
})

export const sessionControlMutationRequestSchema: Schema.Schema<SessionControlMutationRequest> =
  Schema.Struct({
    contractVersion: Schema.Literal(SESSION_CONTROL_CONTRACT_VERSION),
    requestId: sessionInputIdSchema,
    idempotencyKey: sessionInputIdSchema,
    command: Schema.Union(
      delegationAcceptCommandSchema,
      delegationCancelCommandSchema,
      delegationClaimCommandSchema,
      delegationConflictAcknowledgeCommandSchema,
      delegationDependencyCommandSchema,
      delegationProposeAmendmentCommandSchema,
      delegationAmendCommandSchema,
      delegationReopenCommandSchema,
      delegationRequestRevisionCommandSchema,
      delegationStateCommandSchema,
      delegationSubmitCommandSchema,
      delegationVerifyCommandSchema,
      exportCancelCommandSchema,
      exportCreateCommandSchema,
      followUpCommandSchema,
      interruptCommandSchema,
      interruptDescendantsCommandSchema,
      authorizationSetCommandSchema,
      interactionResponseCommandSchema,
      messageCommandSchema,
      ...sessionOrganizationCommandSchemas,
      promoteCommandSchema,
      queueAdoptCommandSchema,
      queueEditBeginCommandSchema,
      queueEditCancelCommandSchema,
      queueEditSaveCommandSchema,
      queuePauseCommandSchema,
      queueReorderCommandSchema,
      queueResumeCommandSchema,
      queueWithdrawCommandSchema,
      reportCommandSchema,
      replaceCommandSchema,
      startCommandSchema,
      steerCommandSchema,
    ),
  })

export const sessionControlMutationResponseSchema: Schema.Schema<SessionControlMutationResponse> =
  Schema.Struct({
    contractVersion: Schema.Literal(SESSION_CONTROL_CONTRACT_VERSION),
    requestId: Schema.String,
    idempotencyKey: Schema.String,
    replayed: Schema.Boolean,
    outcome: sessionControlMutationOutcomeSchema,
  })

export function decodeSessionControlMutationRequest(value: unknown) {
  return decodeUnknownExactOrThrow(sessionControlMutationRequestSchema, value)
}

export function decodeSessionControlMutationResponse(value: unknown) {
  return decodeUnknownExactOrThrow(sessionControlMutationResponseSchema, value)
}

export function decodeSessionControlMutationOutcome(value: unknown) {
  return decodeUnknownExactOrThrow(sessionControlMutationOutcomeSchema, value)
}

const followUpEditHoldReferenceSchema = Schema.Struct({
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  holdId: sessionInputIdSchema,
})

/** A Follow-up edit hold a desktop window names, e.g. to adopt it (ADR 0044). */
export function decodeFollowUpEditHoldReference(value: unknown) {
  return decodeUnknownExactOrThrow(followUpEditHoldReferenceSchema, value)
}
