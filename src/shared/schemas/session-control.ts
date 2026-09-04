import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { MAX_FOLLOW_UP_QUEUE_ITEMS } from '@shared/types/session-control-queue'
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
  Schema.maxItems(MAX_FOLLOW_UP_QUEUE_ITEMS),
  Schema.filter(
    (followUpIds) =>
      new Set(followUpIds).size === followUpIds.length || 'Follow-up IDs must be unique.',
  ),
)

const messageInputSchema = Schema.Struct({
  ...steeringInputSchema.fields,
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  waggle: Schema.optional(waggleInvocationSchema),
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
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  input: messageInputSchema,
})

const replaceCommandSchema = Schema.Struct({
  operation: Schema.Literal('replace'),
  sessionId: sessionInputIdSchema,
  expectedRunId: sessionInputIdSchema,
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  input: messageInputSchema,
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

const queueUpdateAuthorizationCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-update-authorization'),
  sessionId: sessionInputIdSchema,
  followUpId: sessionInputIdSchema,
  runAuthorizationOverride: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
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
      queuePauseCommandSchema,
      queueReorderCommandSchema,
      queueResumeCommandSchema,
      queueUpdateAuthorizationCommandSchema,
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
