import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { THINKING_LEVELS } from '@shared/types/settings'
import { agentLoopResponseSchema } from './agent-loop-interaction'
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
import { sessionOrganizationCommandSchemas } from './session-organization'

export { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
export { sessionControlMutationOutcomeSchema } from './session-control-outcomes'

const steeringInputSchema = Schema.Struct({
  text: Schema.String,
  attachmentIds: Schema.Array(Schema.String),
})

const messageInputSchema = Schema.Struct({
  ...steeringInputSchema.fields,
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
})

const steerCommandSchema = Schema.Struct({
  operation: Schema.Literal('steer'),
  sessionId: Schema.String,
  expectedRunId: Schema.String,
  input: steeringInputSchema,
})

const messageCommandSchema = Schema.Struct({
  operation: Schema.Literal('message'),
  sessionId: Schema.String,
  input: messageInputSchema,
})

const startCommandSchema = Schema.Struct({
  operation: Schema.Literal('start'),
  sessionId: Schema.String,
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  interactionTimeoutMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  input: messageInputSchema,
})

const followUpCommandSchema = Schema.Struct({
  operation: Schema.Literal('follow-up'),
  sessionId: Schema.String,
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  input: messageInputSchema,
})

const replaceCommandSchema = Schema.Struct({
  operation: Schema.Literal('replace'),
  sessionId: Schema.String,
  expectedRunId: Schema.String,
  runAuthorizationOverride: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  input: messageInputSchema,
})

const interruptCommandSchema = Schema.Struct({
  operation: Schema.Literal('interrupt'),
  sessionId: Schema.String,
  expectedRunId: Schema.String,
})

const interruptDescendantsCommandSchema = Schema.Struct({
  operation: Schema.Literal('interrupt-descendants'),
  sessionId: Schema.String,
})

const promoteCommandSchema = Schema.Struct({
  operation: Schema.Literal('promote'),
  sessionId: Schema.String,
  expectedRunId: Schema.String,
  followUpId: Schema.String,
})

const queueWithdrawCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-withdraw'),
  sessionId: Schema.String,
  followUpIds: Schema.Array(Schema.String),
})

const queueReorderCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-reorder'),
  sessionId: Schema.String,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  orderedFollowUpIds: Schema.Array(Schema.String),
})

const queuePauseCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-pause'),
  sessionId: Schema.String,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

const queueResumeCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-resume'),
  sessionId: Schema.String,
  expectedQueueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

const queueUpdateAuthorizationCommandSchema = Schema.Struct({
  operation: Schema.Literal('queue-update-authorization'),
  sessionId: Schema.String,
  followUpId: Schema.String,
  runAuthorizationOverride: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
})

const interactionResponseCommandSchema = Schema.Struct({
  operation: Schema.Literal('request-respond', 'approval-respond'),
  sessionId: Schema.String,
  runId: Schema.String,
  interactionId: Schema.String,
  kind: Schema.Literal('confirm', 'select', 'input', 'editor', 'notify', 'custom'),
  response: agentLoopResponseSchema,
})

const authorizationSetCommandSchema = Schema.Struct({
  operation: Schema.Literal('authorization-set'),
  sessionId: Schema.String,
  authorizationMode: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
})

export const sessionControlMutationRequestSchema: Schema.Schema<SessionControlMutationRequest> =
  Schema.Struct({
    contractVersion: Schema.Literal(SESSION_CONTROL_CONTRACT_VERSION),
    requestId: Schema.String,
    idempotencyKey: Schema.String,
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
