import { type SchemaType, Schema } from '@shared/schema'
import { delegationVerificationOutcomeSchema } from '@shared/schemas/session-collaboration-control'
import { DELEGATION_STATES } from '@shared/types/session-collaboration'
import { sqliteIntegerSchema } from './sqlite-row-schema'

/** The Delegation rows a Delegation query reads; each row type is inferred from its schema. */

const delegationStateSchema = Schema.Literal(...DELEGATION_STATES)
const requiredStateSchema = Schema.Literal('ready_for_review', 'accepted')
const nullableStringSchema = Schema.NullOr(Schema.String)
const nullableIntegerSchema = Schema.NullOr(sqliteIntegerSchema)

/** A history row also carries its table's rowid, which orders and pages a Delegation read. */
export function historyRowSchema<Fields extends Schema.Struct.Fields>(row: Schema.Struct<Fields>) {
  return Schema.Struct({ ...row.fields, cursor_id: sqliteIntegerSchema })
}

export const delegationSummaryRowSchema = Schema.Struct({
  delegation_id: Schema.String,
  parent_session_id: Schema.String,
  worker_session_id: Schema.String,
  state: delegationStateSchema,
  specification_json: Schema.String,
  current_specification_revision: sqliteIntegerSchema,
  latest_submission_revision: sqliteIntegerSchema,
  created_at: sqliteIntegerSchema,
  updated_at: sqliteIntegerSchema,
})
export type DelegationSummaryRow = SchemaType<typeof delegationSummaryRowSchema>

export const specificationRowSchema = Schema.Struct({
  revision: sqliteIntegerSchema,
  specification_json: Schema.String,
  authored_by: Schema.String,
  reason: nullableStringSchema,
  created_at: sqliteIntegerSchema,
})
export type SpecificationRow = SchemaType<typeof specificationRowSchema>

export const submissionRowSchema = Schema.Struct({
  revision: sqliteIntegerSchema,
  specification_revision: sqliteIntegerSchema,
  summary: Schema.String,
  submitted_by: Schema.String,
  source_run_id: nullableStringSchema,
  provenance: Schema.Literal('agent-submitted', 'host-captured'),
  created_at: sqliteIntegerSchema,
})
export type SubmissionRow = SchemaType<typeof submissionRowSchema>

export const evidenceRowSchema = Schema.Struct({
  submission_revision: sqliteIntegerSchema,
  kind: Schema.String,
  summary: Schema.String,
  reference: nullableStringSchema,
  provenance_json: nullableStringSchema,
})
export type EvidenceRow = SchemaType<typeof evidenceRowSchema>

export const reviewRowSchema = Schema.Struct({
  submission_revision: sqliteIntegerSchema,
  decision: Schema.Literal('revision_requested', 'accepted'),
  feedback: nullableStringSchema,
  reviewer_session_id: Schema.String,
  reviewed_by: Schema.String,
  specification_revision: sqliteIntegerSchema,
  created_at: sqliteIntegerSchema,
})
export type ReviewRow = SchemaType<typeof reviewRowSchema>

export const dependencyRowSchema = Schema.Struct({
  delegation_id: Schema.String,
  required_state: requiredStateSchema,
  current_state: delegationStateSchema,
})
export type DependencyRow = SchemaType<typeof dependencyRowSchema>

export const transitionRowSchema = Schema.Struct({
  from_state: delegationStateSchema,
  to_state: delegationStateSchema,
  reason: Schema.String,
  actor_session_id: Schema.String,
  authored_by: Schema.String,
  created_at: sqliteIntegerSchema,
})
export type TransitionRow = SchemaType<typeof transitionRowSchema>

export const claimRevisionRowSchema = Schema.Struct({
  revision: sqliteIntegerSchema,
  actor_session_id: Schema.String,
  authored_by: Schema.String,
  reason: Schema.String,
  created_at: sqliteIntegerSchema,
})
export type ClaimRevisionRow = SchemaType<typeof claimRevisionRowSchema>

export const claimRowSchema = Schema.Struct({
  revision: sqliteIntegerSchema,
  access: Schema.Literal('read', 'write'),
  target_kind: Schema.Literal('workspace-file', 'workspace-tree', 'named-resource'),
  target_value: Schema.String,
  target_namespace: nullableStringSchema,
  target_scope: Schema.NullOr(Schema.Literal('project', 'repository')),
})
export type ClaimRow = SchemaType<typeof claimRowSchema>

export const undeclaredWriteRowSchema = Schema.Struct({
  id: Schema.String,
  worker_session_id: Schema.String,
  run_id: Schema.String,
  path: Schema.String,
  claim_revision: nullableIntegerSchema,
  provenance: Schema.Literal('isolated-turn-checkpoint'),
  created_at: sqliteIntegerSchema,
})
export type UndeclaredWriteRow = SchemaType<typeof undeclaredWriteRowSchema>

export const conflictRowSchema = Schema.Struct({
  id: Schema.String,
  left_delegation_id: Schema.String,
  right_delegation_id: Schema.String,
  kind: Schema.Literal('live-overlap', 'merge-overlap'),
  evidence_json: Schema.String,
  acknowledged_by: nullableStringSchema,
  acknowledgement_reason: nullableStringSchema,
  acknowledged_at: nullableIntegerSchema,
  resolved_at: nullableIntegerSchema,
  created_at: sqliteIntegerSchema,
})
export type ConflictRow = SchemaType<typeof conflictRowSchema>

export const amendmentProposalRowSchema = Schema.Struct({
  id: Schema.String,
  base_specification_revision: sqliteIntegerSchema,
  specification_json: Schema.String,
  reason: Schema.String,
  actor_session_id: Schema.String,
  proposed_by: Schema.String,
  status: Schema.Literal('pending', 'applied'),
  reviewed_by: nullableStringSchema,
  applied_specification_revision: nullableIntegerSchema,
  created_at: sqliteIntegerSchema,
  updated_at: sqliteIntegerSchema,
})
export type AmendmentProposalRow = SchemaType<typeof amendmentProposalRowSchema>

export const verificationRowSchema = Schema.Struct({
  id: Schema.String,
  submission_revision: sqliteIntegerSchema,
  specification_revision: sqliteIntegerSchema,
  verifier_session_id: Schema.String,
  verified_by: Schema.String,
  outcome: delegationVerificationOutcomeSchema,
  summary: Schema.String,
  created_at: sqliteIntegerSchema,
})
export type VerificationRow = SchemaType<typeof verificationRowSchema>

export const verificationEvidenceRowSchema = Schema.Struct({
  verification_id: Schema.String,
  kind: Schema.String,
  summary: Schema.String,
  reference: nullableStringSchema,
  provenance_json: nullableStringSchema,
})
export type VerificationEvidenceRow = SchemaType<typeof verificationEvidenceRowSchema>

export const delegationHistoryKindSchema = Schema.Literal(
  'amendment',
  'claim',
  'conflict',
  'review',
  'specification',
  'submission',
  'transition',
  'undeclared-write',
  'verification',
)

/** One entry of a Delegation's merged history, before its row is read. */
export const delegationHistoryDescriptorRowSchema = Schema.Struct({
  kind: delegationHistoryKindSchema,
  cursor_id: sqliteIntegerSchema,
  created_at: sqliteIntegerSchema,
  estimated_bytes: Schema.Number,
})

/** The highest rowid of each Delegation history table when a read starts. */
export const delegationHistoryHighWaterRowSchema = Schema.Struct({
  amendment: sqliteIntegerSchema,
  claim: sqliteIntegerSchema,
  conflict: sqliteIntegerSchema,
  review: sqliteIntegerSchema,
  specification: sqliteIntegerSchema,
  submission: sqliteIntegerSchema,
  transition: sqliteIntegerSchema,
  undeclared_write: sqliteIntegerSchema,
  verification: sqliteIntegerSchema,
})
