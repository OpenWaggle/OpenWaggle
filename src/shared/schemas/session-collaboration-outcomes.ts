import { Schema } from '@shared/schema'
import { DELEGATION_STATES } from '@shared/types/session-collaboration'
import { delegationVerificationOutcomeSchema } from './session-collaboration-control'

export const delegationUpdatedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal(
    'delegation-submit',
    'delegation-request-revision',
    'delegation-accept',
    'delegation-cancel',
    'delegation-reopen',
    'delegation-state',
  ),
  effect: Schema.Literal('delegation-updated'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  parentSessionId: Schema.String,
  workerSessionId: Schema.String,
  delegationState: Schema.Literal(...DELEGATION_STATES),
  specificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  specificationChanged: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

export const delegationClaimsUpdatedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('delegation-claim'),
  effect: Schema.Literal('delegation-claims-updated'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  claimRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  conflictIds: Schema.Array(Schema.String),
})

export const delegationConflictAcknowledgedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('delegation-conflict-acknowledge'),
  effect: Schema.Literal('delegation-conflict-acknowledged'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  conflictId: Schema.String,
  acknowledgedAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

export const delegationDependenciesUpdatedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('delegation-dependency'),
  effect: Schema.Literal('delegation-dependencies-updated'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  delegationState: Schema.Literal(...DELEGATION_STATES),
  specificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  dependencyCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  workerSessionId: Schema.String,
})

export const delegationAmendmentProposedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('delegation-propose-amendment'),
  effect: Schema.Literal('delegation-amendment-proposed'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  proposalId: Schema.String,
  baseSpecificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
})

export const delegationSpecificationAmendedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('delegation-amend'),
  effect: Schema.Literal('delegation-specification-amended'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  delegationState: Schema.Literal(...DELEGATION_STATES),
  specificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  appliedProposalId: Schema.optionalWith(Schema.String, { exact: true }),
  workerSessionId: Schema.String,
})

export const delegationVerificationRecordedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('delegation-verify'),
  effect: Schema.Literal('delegation-verification-recorded'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  verificationId: Schema.String,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  verificationOutcome: delegationVerificationOutcomeSchema,
  createdAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})
