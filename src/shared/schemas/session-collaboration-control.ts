import { Schema } from '@shared/schema'
import { delegationSpecificationSchema } from './session-lifecycle'

const reportTargetSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('upstream') }),
  Schema.Struct({ type: Schema.Literal('queen') }),
  Schema.Struct({ type: Schema.Literal('session'), sessionId: Schema.String }),
  Schema.Struct({ type: Schema.Literal('sessions'), sessionIds: Schema.Array(Schema.String) }),
  Schema.Struct({ type: Schema.Literal('worker-reference'), reference: Schema.String }),
)

export const reportCommandSchema = Schema.Struct({
  operation: Schema.Literal('report'),
  sessionId: Schema.String,
  sourceRunId: Schema.optional(Schema.String),
  target: reportTargetSchema,
  input: Schema.Struct({
    text: Schema.String,
    requestReply: Schema.Boolean,
    replyToReportId: Schema.optional(Schema.String),
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
  summary: Schema.String,
  reference: Schema.optional(Schema.String),
  provenance: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})

export const delegationSubmitCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-submit'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  summary: Schema.String,
  evidence: Schema.Array(delegationEvidenceSchema),
})

const revisedDelegationSpecificationSchema = Schema.Struct({
  objective: Schema.String,
  deliverables: Schema.Array(Schema.String),
  acceptanceCriteria: Schema.Array(Schema.String),
  handoffContext: Schema.optional(Schema.String),
  resourceReferences: Schema.Array(Schema.String),
})

export const delegationRequestRevisionCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-request-revision'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  feedback: Schema.String,
  revisedSpecification: Schema.optional(revisedDelegationSpecificationSchema),
})

export const delegationAcceptCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-accept'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  note: Schema.optional(Schema.String),
})

export const delegationReopenCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-reopen'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  reason: Schema.String,
})

export const delegationCancelCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-cancel'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  reason: Schema.String,
})

export const delegationStateCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-state'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  state: Schema.Literal('working', 'waiting', 'needs_attention'),
  reason: Schema.String,
})

export const delegationClaimTargetSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('workspace-file'), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal('workspace-tree'), path: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('named-resource'),
    scope: Schema.Literal('project', 'repository'),
    namespace: Schema.String,
    name: Schema.String,
  }),
)

export const delegationScopeClaimSchema = Schema.Struct({
  access: Schema.Literal('read', 'write'),
  target: delegationClaimTargetSchema,
})

export const delegationClaimCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-claim'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  claims: Schema.Array(delegationScopeClaimSchema),
  reason: Schema.String,
})

export const delegationConflictAcknowledgeCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-conflict-acknowledge'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  conflictId: Schema.String,
  reason: Schema.String,
})

export const delegationDependencyCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-dependency'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  action: Schema.Literal('add', 'remove'),
  dependencyDelegationId: Schema.String,
  requiredState: Schema.Literal('ready_for_review', 'accepted'),
  reason: Schema.String,
})

export const delegationProposeAmendmentCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-propose-amendment'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  baseSpecificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  specification: delegationSpecificationSchema,
  reason: Schema.String,
})

export const delegationAmendCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-amend'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  expectedSpecificationRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  specification: delegationSpecificationSchema,
  reason: Schema.String,
  proposalId: Schema.optional(Schema.String),
})

export const delegationVerifyCommandSchema = Schema.Struct({
  operation: Schema.Literal('delegation-verify'),
  sessionId: Schema.String,
  delegationId: Schema.String,
  submissionRevision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  outcome: Schema.Literal('passed', 'failed', 'inconclusive'),
  summary: Schema.String,
  evidence: Schema.Array(delegationEvidenceSchema),
})
