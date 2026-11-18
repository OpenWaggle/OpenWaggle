import { SESSION_HOST_ERROR_KINDS } from '@shared/domain/session-host-refusals'
import { Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { SESSION_CONTROL_MUTATION_OPERATIONS } from '@shared/types/session-control'
import { FOLLOW_UP_QUEUE_PAUSE_REASONS } from '@shared/types/session-control-queue'
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

export const stateRevisionSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

export const steeringReceiptSchema = Schema.Union(
  Schema.Struct({
    delivery: Schema.Literal('queued'),
    durableTextSha256: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
    minimumCreatedOrder: stateRevisionSchema,
  }),
  Schema.Struct({ delivery: Schema.Literal('handled') }),
  Schema.Struct({ delivery: Schema.Literal('unavailable') }),
)

export const messageStartedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('message'),
  effect: Schema.Literal('started-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

export const followUpQueuedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('follow-up'),
  effect: Schema.Literal('queued-follow-up'),
  sessionId: Schema.String,
  followUpId: Schema.String,
  /** Absent only in outcomes recorded before 1.0.0-rc.1. */
  queueState: Schema.optionalWith(Schema.Literal('running', 'paused'), { exact: true }),
  /** Why a paused queue holds the Follow-up, when the Host recorded it. */
  pauseReason: Schema.optionalWith(Schema.Literal(...FOLLOW_UP_QUEUE_PAUSE_REASONS), {
    exact: true,
  }),
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

export const followUpStartedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('follow-up'),
  effect: Schema.Literal('started-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

export const messageQueuedFollowUpOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('message'),
  effect: Schema.Literal('queued-follow-up'),
  sessionId: Schema.String,
  followUpId: Schema.String,
  /** Absent only in outcomes recorded before 1.0.0-rc.1. */
  queueState: Schema.optionalWith(Schema.Literal('running', 'paused'), { exact: true }),
  /** Why a paused queue holds the Follow-up, when the Host recorded it. */
  pauseReason: Schema.optionalWith(Schema.Literal(...FOLLOW_UP_QUEUE_PAUSE_REASONS), {
    exact: true,
  }),
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

export const startStartedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('start'),
  effect: Schema.Literal('started-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

export const steeredRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('steer'),
  effect: Schema.Literal('steered-run'),
  receipt: steeringReceiptSchema,
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

export const interruptionRequestedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('interrupt'),
  effect: Schema.Literal('interruption-requested'),
  sessionId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

export const interactionResolvedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('request-respond', 'approval-respond'),
  effect: Schema.Literal('interaction-resolved'),
  sessionId: Schema.String,
  runId: Schema.String,
  interactionId: Schema.String,
  status: Schema.Literal('pending', 'resolved', 'cancelled', 'errored'),
})

export const authorizationUpdatedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('authorization-set'),
  effect: Schema.Literal('authorization-updated'),
  sessionId: Schema.String,
  authorizationMode: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  effectiveAuthorizationMode: Schema.Literal(...AGENT_AUTHORIZATION_MODES),
})

export const descendantInterruptionsRequestedOutcomeSchema = Schema.Struct({
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

export const promotedFollowUpOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('promote'),
  effect: Schema.Literal('promoted-follow-up'),
  receipt: steeringReceiptSchema,
  sessionId: Schema.String,
  runId: Schema.String,
  followUpId: Schema.String,
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

export const replacedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('replace'),
  effect: Schema.Literal('replaced-run'),
  sessionId: Schema.String,
  interruptedRunId: Schema.String,
  runId: Schema.String,
  stateRevision: stateRevisionSchema,
})

export const acceptedReportOutcomeSchema = Schema.Struct({
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

export const queueUpdatedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal(
    'queue-adopt',
    'queue-edit-cancel',
    'queue-edit-save',
    'queue-pause',
    'queue-reorder',
    'queue-resume',
    'queue-withdraw',
  ),
  effect: Schema.Literal('queue-updated'),
  sessionId: Schema.String,
  queueState: Schema.Literal('running', 'paused'),
  queueRevision: stateRevisionSchema,
  /** The Follow-ups still queued after the change, in delivery order. */
  remainingFollowUpIds: Schema.Array(Schema.String),
  /** `queue-withdraw` only: the Follow-ups this call removed. */
  withdrawnFollowUpIds: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  stateRevision: stateRevisionSchema,
})

/**
 * A queue change that leaves an idle Session's queue able to deliver starts its next Follow-up,
 * the same way resumption does (for example withdrawing or saving a held head).
 */
export const queueResumeStartedRunOutcomeSchema = Schema.Struct({
  operation: Schema.Literal(
    'queue-resume',
    'queue-withdraw',
    'queue-reorder',
    'queue-adopt',
    'queue-edit-save',
    'queue-edit-cancel',
  ),
  effect: Schema.Literal('started-run'),
  sessionId: Schema.String,
  runId: Schema.String,
  followUpId: Schema.String,
  /** `queue-withdraw` only: the Follow-ups this call removed. */
  withdrawnFollowUpIds: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

/** The `queue-edit-begin` outcome: the Host holds the Follow-up for this caller's edit. */
export const followUpEditHeldOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('queue-edit-begin'),
  effect: Schema.Literal('follow-up-edit-held'),
  sessionId: Schema.String,
  followUpId: Schema.String,
  /** Names the hold to save, cancel, or renew it. Only the holder learns it. */
  holdId: Schema.String,
  /** When the hold expires unless renewed (Host clock, epoch milliseconds). */
  leaseExpiresAt: stateRevisionSchema,
  queueRevision: stateRevisionSchema,
  stateRevision: stateRevisionSchema,
})

export const rejectedMutationOutcomeSchema = Schema.Struct({
  operation: Schema.Literal(...SESSION_CONTROL_MUTATION_OPERATIONS),
  effect: Schema.Literal('rejected'),
  sessionId: Schema.String,
  code: Schema.String,
  /** The kind of refusal, from the Session Host's refusal table (ADR 0063). */
  kind: Schema.Literal(...SESSION_HOST_ERROR_KINDS),
})

export const sessionControlMutationOutcomeSchema = Schema.Union(
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
  followUpStartedRunOutcomeSchema,
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
  followUpEditHeldOutcomeSchema,
  rejectedMutationOutcomeSchema,
)
