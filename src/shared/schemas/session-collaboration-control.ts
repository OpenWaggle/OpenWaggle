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

const reportTargetSchema = Schema.Union(
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
  sourceRunId: Schema.optional(sessionInputIdSchema),
  target: reportTargetSchema,
  input: Schema.Struct({
    text: sessionInputTextSchema,
    requestReply: Schema.Boolean,
    replyToReportId: Schema.optional(sessionInputIdSchema),
  }),
})

const delegationEvidenceSchema = Schema.Struct({
  kind: Schema.Literal(
    'observed-command',
    'workspace-diff',
    'artifact',
    'source-reference',
    'asserted-note',
  ),
  summary: sessionInputItemTextSchema,
  reference: Schema.optional(sessionInputItemTextSchema),
  provenance: Schema.optional(
    Schema.Record({ key: sessionInputItemTextSchema, value: sessionInputItemTextSchema }).pipe(
      Schema.filter(sessionInputJsonWithinLimit),
    ),
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
  handoffContext: Schema.optional(sessionInputTextSchema),
  resourceReferences: uniqueStringsSchema,
})

export const delegationRequestRevisionCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-request-revision'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  feedback: sessionInputTextSchema,
  revisedSpecification: Schema.optional(revisedDelegationSpecificationSchema),
})

export const delegationAcceptCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-accept'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  note: Schema.optional(sessionInputItemTextSchema),
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
  proposalId: Schema.optional(sessionInputIdSchema),
})

export const delegationVerifyCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-verify'),
  sessionId: sessionInputIdSchema,
  delegationId: sessionInputIdSchema,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  outcome: Schema.Literal('passed', 'failed', 'inconclusive'),
  summary: sessionInputItemTextSchema,
  evidence: delegationEvidenceCollectionSchema,
})
