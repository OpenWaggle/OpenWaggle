import type { SchemaType } from '@shared/schema'
import type {
  delegationAcceptCommandSchema,
  delegationAmendCommandSchema,
  delegationCancelCommandSchema,
  delegationClaimCommandSchema,
  delegationClaimTargetSchema,
  delegationConflictAcknowledgeCommandSchema,
  delegationDependencyCommandSchema,
  delegationEvidenceKindSchema,
  delegationEvidenceSchema,
  delegationProposeAmendmentCommandSchema,
  delegationReopenCommandSchema,
  delegationRequestRevisionCommandSchema,
  delegationScopeClaimSchema,
  delegationStateCommandSchema,
  delegationSubmitCommandSchema,
  delegationVerifyCommandSchema,
  reportCommandSchema,
  reportTargetSchema,
} from '@shared/schemas/session-collaboration-control'

export type SessionControlReportTarget = SchemaType<typeof reportTargetSchema>

export type SessionControlReportCommand = SchemaType<typeof reportCommandSchema>

export type DelegationEvidenceKind = SchemaType<typeof delegationEvidenceKindSchema>

export const DELEGATION_STATES = [
  'working',
  'waiting',
  'needs_attention',
  'ready_for_review',
  'revision_requested',
  'accepted',
  'cancelled',
] as const

export type DelegationState = (typeof DELEGATION_STATES)[number]

export type DelegationEvidenceInput = SchemaType<typeof delegationEvidenceSchema>

export type SessionControlDelegationSubmitCommand = SchemaType<typeof delegationSubmitCommandSchema>

export type SessionControlDelegationRequestRevisionCommand = SchemaType<
  typeof delegationRequestRevisionCommandSchema
>

export type SessionControlDelegationAcceptCommand = SchemaType<typeof delegationAcceptCommandSchema>

export type SessionControlDelegationReopenCommand = SchemaType<typeof delegationReopenCommandSchema>

export type SessionControlDelegationCancelCommand = SchemaType<typeof delegationCancelCommandSchema>

export type SessionControlDelegationStateCommand = SchemaType<typeof delegationStateCommandSchema>

export type DelegationClaimTarget = SchemaType<typeof delegationClaimTargetSchema>

export type DelegationScopeClaimInput = SchemaType<typeof delegationScopeClaimSchema>

export type SessionControlDelegationClaimCommand = SchemaType<typeof delegationClaimCommandSchema>

export type SessionControlDelegationConflictAcknowledgeCommand = SchemaType<
  typeof delegationConflictAcknowledgeCommandSchema
>

export type SessionControlDelegationDependencyCommand = SchemaType<
  typeof delegationDependencyCommandSchema
>

export type SessionControlDelegationProposeAmendmentCommand = SchemaType<
  typeof delegationProposeAmendmentCommandSchema
>

export type SessionControlDelegationAmendCommand = SchemaType<typeof delegationAmendCommandSchema>

export type SessionControlDelegationVerifyCommand = SchemaType<typeof delegationVerifyCommandSchema>
