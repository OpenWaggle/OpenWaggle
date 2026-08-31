import { Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import {
  SESSION_CONTROL_MUTATION_OPERATIONS,
  type SessionControlMutationOutcome,
} from '@shared/types/session-control'
import {
  delegationAmendmentProposedOutcomeSchema,
  delegationClaimsUpdatedOutcomeSchema,
  delegationConflictAcknowledgedOutcomeSchema,
  delegationDependenciesUpdatedOutcomeSchema,
  delegationSpecificationAmendedOutcomeSchema,
  delegationUpdatedOutcomeSchema,
  delegationVerificationRecordedOutcomeSchema,
} from './session-collaboration-outcomes'
import { exportCancelOutcomeSchema, exportCreateOutcomeSchema } from './session-export-operation'
import { sessionOrganizationOutcomeSchemas } from './session-organization'

const stateRevisionSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

const messageStartedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('message'),
  effect: Schema.Literal('started-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

const followUpQueuedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('follow-up'),
  effect: Schema.Literal('queued-follow-up'),
  sessionId: Schema.String,
  followUpId: Schema.String,
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

const messageQueuedFollowUpOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('message'),
  effect: Schema.Literal('queued-follow-up'),
  sessionId: Schema.String,
  followUpId: Schema.String,
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

const startStartedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('start'),
  effect: Schema.Literal('started-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

const steeredRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('steer'),
  effect: Schema.Literal('steered-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

const interruptionRequestedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('interrupt'),
  effect: Schema.Literal('interruption-requested'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

const interactionResolvedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('request-respond', 'approval-respond'),
  effect: Schema.Literal('interaction-resolved'),
  sessionId: Schema.String,
  runId: Schema.String,
  interactionId: Schema.String,
  status: Schema.Literal('pending', 'resolved', 'cancelled', 'errored'),
})

const authorizationUpdatedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('authorization-set'),
  effect: Schema.Literal('authorization-updated'),
  sessionId: Schema.String,
  authorizationMode: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  effectiveAuthorizationMode: Schema.Literal(...AGENT_AUTHORIZATION_MODES),
})

const descendantInterruptionsRequestedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('interrupt-descendants'),
  effect: Schema.Literal('descendant-interruptions-requested'),
  sessionId: Schema.String,
  interrupted: Schema.Array(
    Schema.Struct({
      sessionId: Schema.String,
      runId: Schema.String,
      stateRevision: stateRevisionSchema,
    }),
  ),
  stateRevision: stateRevisionSchema,
})

const promotedFollowUpOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('promote'),
  effect: Schema.Literal('promoted-follow-up'),
  sessionId: Schema.String,
  runId: Schema.String,
  followUpId: Schema.String,
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

const replacedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('replace'),
  effect: Schema.Literal('replaced-run'),
  sessionId: Schema.String,
  interruptedRunId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

const acceptedReportOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('report'),
  effect: Schema.Literal('accepted-report'),
  sessionId: Schema.String,
  reportId: Schema.String,
  correlationId: Schema.String,
  targetSessionIds: Schema.Array(Schema.String),
  deliveryStates: Schema.Array(
    Schema.Struct({
      sessionId: Schema.String,
      status: Schema.Literal('pending', 'delivered'),
    }),
  ),
})

const queueUpdatedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal(
    'queue-pause',
    'queue-reorder',
    'queue-resume',
    'queue-update-authorization',
    'queue-withdraw',
  ),
  effect: Schema.Literal('queue-updated'),
  sessionId: Schema.String,
  queueState: Schema.Literal('running', 'paused'),
  queueRevision: stateRevisionSchema,
  followUpIds: Schema.Array(Schema.String),
  stateRevision: stateRevisionSchema,
})

const queueResumeStartedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('queue-resume'),
  effect: Schema.Literal('started-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  followUpId: Schema.String,
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

const rejectedMutationOutcomeSchema = Schema.Struct({
  operation: Schema.Literal(...SESSION_CONTROL_MUTATION_OPERATIONS),
  effect: Schema.Literal('rejected'),
  sessionId: Schema.String,
  code: Schema.String,
})

export const sessionControlMutationOutcomeSchema: Schema.Schema<SessionControlMutationOutcome> =
  Schema.Union(
    delegationUpdatedOutcomeSchema,
    delegationClaimsUpdatedOutcomeSchema,
    delegationConflictAcknowledgedOutcomeSchema,
    delegationDependenciesUpdatedOutcomeSchema,
    delegationAmendmentProposedOutcomeSchema,
    delegationSpecificationAmendedOutcomeSchema,
    delegationVerificationRecordedOutcomeSchema,
    exportCancelOutcomeSchema,
    exportCreateOutcomeSchema,
    followUpQueuedOutcomeSchema,
    messageStartedRunOutcomeSchema,
    messageQueuedFollowUpOutcomeSchema,
    ...sessionOrganizationOutcomeSchemas,
    startStartedRunOutcomeSchema,
    steeredRunOutcomeSchema,
    interruptionRequestedOutcomeSchema,
    interactionResolvedOutcomeSchema,
    authorizationUpdatedOutcomeSchema,
    descendantInterruptionsRequestedOutcomeSchema,
    promotedFollowUpOutcomeSchema,
    replacedRunOutcomeSchema,
    acceptedReportOutcomeSchema,
    queueUpdatedOutcomeSchema,
    queueResumeStartedRunOutcomeSchema,
    rejectedMutationOutcomeSchema,
  )
