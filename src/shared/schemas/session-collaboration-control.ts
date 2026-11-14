import { Schema } from '@shared/schema'
import {
  hasUniqueCollaborationStrings,
  hasUniqueCollaborationStructures,
  SESSION_COLLABORATION_COLLECTION_LIMIT,
} from '@shared/session-collaboration-collections'
import { SESSION_REPORT_REFERENCE_MAX_LENGTH } from '@shared/session-report-reference'
import {
  sessionInputIdSchema,
  sessionInputItemTextSchema,
  sessionInputJsonWithinLimit,
  sessionInputPathSchema,
  sessionInputTextSchema,
} from './session-input'
import { delegationSpecificationSchema } from './session-lifecycle'

const uniqueStringsSchema = Schema.Array(sessionInputItemTextSchema).pipe(
  Schema.maxItems(SESSION_COLLABORATION_COLLECTION_LIMIT),
  Schema.filter(
    (items) => hasUniqueCollaborationStrings(items) || 'Collaboration items must be unique.',
  ),
)

export const delegationEvidenceKindSchema = Schema.Literal(
  'observed-command',
  'workspace-diff',
  'artifact',
  'source-reference',
  'asserted-note',
)

export const delegationVerificationOutcomeSchema = Schema.Literal(
  'passed',
  'failed',
  'inconclusive',
)

export const reportTargetSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('upstream') }),
  Schema.Struct({ type: Schema.Literal('queen') }),
  Schema.Struct({ type: Schema.Literal('session'), sessionId: sessionInputIdSchema }),
  Schema.Struct({
    type: Schema.Literal('sessions'),
    sessionIds: Schema.Array(sessionInputIdSchema).pipe(
      Schema.maxItems(SESSION_COLLABORATION_COLLECTION_LIMIT),
      Schema.filter(
        (items) => hasUniqueCollaborationStrings(items) || 'Collaboration items must be unique.',
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal('worker-reference'),
    reference: Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(SESSION_REPORT_REFERENCE_MAX_LENGTH),
    ),
  }),
)

export const reportCommandSchema = Schema.Struct({
  operation: Schema.Literal('report'),
  sessionId: sessionInputIdSchema,
  sourceRunId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  target: reportTargetSchema,
  input: Schema.Struct({
    text: sessionInputTextSchema,
    requestReply: Schema.Boolean,
    replyToReportId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  }),
})

export const delegationEvidenceSchema = Schema.Struct({
  kind: delegationEvidenceKindSchema,
  summary: sessionInputItemTextSchema,
  reference: Schema.optionalWith(sessionInputItemTextSchema, { exact: true }),
  provenance: Schema.optionalWith(
    Schema.Record({ key: sessionInputItemTextSchema, value: sessionInputItemTextSchema }).pipe(
      Schema.filter(sessionInputJsonWithinLimit),
    ),
    { exact: true },
  ),
})

const delegationEvidenceCollectionSchema = Schema.Array(delegationEvidenceSchema).pipe(
  Schema.maxItems(SESSION_COLLABORATION_COLLECTION_LIMIT),
  Schema.filter(
    (items) =>
      hasUniqueCollaborationStructures(items) || 'Delegation evidence items must be unique.',
  ),
)

export const delegationSubmitCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-submit'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  summary: sessionInputItemTextSchema,
  evidence: delegationEvidenceCollectionSchema,
})

const revisedDelegationSpecificationSchema = Schema.Struct({
  objective: sessionInputTextSchema,
  deliverables: uniqueStringsSchema,
  acceptanceCriteria: uniqueStringsSchema,
  handoffContext: Schema.optionalWith(sessionInputTextSchema, { exact: true }),
  resourceReferences: uniqueStringsSchema,
})

export const delegationRequestRevisionCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-request-revision'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  feedback: sessionInputTextSchema,
  revisedSpecification: Schema.optionalWith(revisedDelegationSpecificationSchema, { exact: true }),
})

export const delegationAcceptCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-accept'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  note: Schema.optionalWith(sessionInputItemTextSchema, { exact: true }),
})

export const delegationReopenCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-reopen'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  reason: sessionInputItemTextSchema,
})

export const delegationCancelCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-cancel'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  reason: sessionInputItemTextSchema,
})

export const delegationStateCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-state'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  state: Schema.Literal('working', 'waiting', 'needs_attention'),
  reason: sessionInputItemTextSchema,
})

export const delegationClaimTargetSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('workspace-file'), path: sessionInputPathSchema }),
  Schema.Struct({ type: Schema.Literal('workspace-tree'), path: sessionInputPathSchema }),
  Schema.Struct({
    type: Schema.Literal('named-resource'),
    scope: Schema.Literal('project', 'repository'),
    namespace: sessionInputIdSchema,
    name: sessionInputIdSchema,
  }),
)

export const delegationScopeClaimSchema = Schema.Struct({
  access: Schema.Literal('read', 'write'),
  target: delegationClaimTargetSchema,
})

const delegationClaimsSchema = Schema.Array(delegationScopeClaimSchema).pipe(
  Schema.maxItems(SESSION_COLLABORATION_COLLECTION_LIMIT),
  Schema.filter(
    (items) => hasUniqueCollaborationStructures(items) || 'Delegation claims must be unique.',
  ),
)

export const delegationClaimCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-claim'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  claims: delegationClaimsSchema,
  reason: sessionInputItemTextSchema,
})

export const delegationConflictAcknowledgeCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-conflict-acknowledge'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  conflictId: sessionInputIdSchema,
  reason: sessionInputItemTextSchema,
})

export const delegationDependencyCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-dependency'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  action: Schema.Literal('add', 'remove'),
  dependencyDelegationId: sessionInputIdSchema,
  requiredState: Schema.Literal('ready_for_review', 'accepted'),
  reason: sessionInputItemTextSchema,
})

export const delegationProposeAmendmentCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-propose-amendment'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  baseSpecificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  specification: delegationSpecificationSchema,
  reason: sessionInputItemTextSchema,
})

export const delegationAmendCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-amend'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  expectedSpecificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  specification: delegationSpecificationSchema,
  reason: sessionInputItemTextSchema,
  proposalId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
})

export const delegationVerifyCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-verify'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  outcome: delegationVerificationOutcomeSchema,
  summary: sessionInputItemTextSchema,
  evidence: delegationEvidenceCollectionSchema,
})
