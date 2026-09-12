export type SessionControlReportTarget =
  | { readonly type: 'upstream' }
  | { readonly type: 'queen' }
  | { readonly type: 'session'; readonly sessionId: string }
  | { readonly type: 'sessions'; readonly sessionIds: readonly string[] }
  | { readonly type: 'worker-reference'; readonly reference: string }

export interface SessionControlReportCommand {
  readonly operation: 'report'
  readonly sessionId: string
  readonly sourceRunId?: string
  readonly target: SessionControlReportTarget
  readonly input: {
    readonly text: string
    readonly requestReply: boolean
    readonly replyToReportId?: string
  }
}

export type DelegationEvidenceKind =
  | 'observed-command'
  | 'workspace-diff'
  | 'artifact'
  | 'source-reference'
  | 'asserted-note'

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

export interface DelegationEvidenceInput {
  readonly kind: DelegationEvidenceKind
  readonly summary: string
  readonly reference?: string
  readonly provenance?: Readonly<Record<string, string>>
}

export interface SessionControlDelegationSubmitCommand {
  readonly operation: 'delegation-submit'
  readonly sessionId: string
  readonly delegationId: string
  readonly summary: string
  readonly evidence: readonly DelegationEvidenceInput[]
}

export interface SessionControlDelegationRequestRevisionCommand {
  readonly operation: 'delegation-request-revision'
  readonly sessionId: string
  readonly delegationId: string
  readonly submissionRevision: number
  readonly feedback: string
  readonly revisedSpecification?: {
    readonly objective: string
    readonly deliverables: readonly string[]
    readonly acceptanceCriteria: readonly string[]
    readonly handoffContext?: string
    readonly resourceReferences: readonly string[]
  }
}

export interface SessionControlDelegationAcceptCommand {
  readonly operation: 'delegation-accept'
  readonly sessionId: string
  readonly delegationId: string
  readonly submissionRevision: number
  readonly note?: string
}

export interface SessionControlDelegationReopenCommand {
  readonly operation: 'delegation-reopen'
  readonly sessionId: string
  readonly delegationId: string
  readonly reason: string
}

export interface SessionControlDelegationCancelCommand {
  readonly operation: 'delegation-cancel'
  readonly sessionId: string
  readonly delegationId: string
  readonly reason: string
}

export interface SessionControlDelegationStateCommand {
  readonly operation: 'delegation-state'
  readonly sessionId: string
  readonly delegationId: string
  readonly state: 'working' | 'waiting' | 'needs_attention'
  readonly reason: string
}

export type DelegationClaimTarget =
  | { readonly type: 'workspace-file'; readonly path: string }
  | { readonly type: 'workspace-tree'; readonly path: string }
  | {
      readonly type: 'named-resource'
      readonly scope: 'project' | 'repository'
      readonly namespace: string
      readonly name: string
    }

export interface DelegationScopeClaimInput {
  readonly access: 'read' | 'write'
  readonly target: DelegationClaimTarget
}

export interface SessionControlDelegationClaimCommand {
  readonly operation: 'delegation-claim'
  readonly sessionId: string
  readonly delegationId: string
  readonly claims: readonly DelegationScopeClaimInput[]
  readonly reason: string
}

export interface SessionControlDelegationConflictAcknowledgeCommand {
  readonly operation: 'delegation-conflict-acknowledge'
  readonly sessionId: string
  readonly delegationId: string
  readonly conflictId: string
  readonly reason: string
}

export interface SessionControlDelegationDependencyCommand {
  readonly operation: 'delegation-dependency'
  readonly sessionId: string
  readonly delegationId: string
  readonly action: 'add' | 'remove'
  readonly dependencyDelegationId: string
  readonly requiredState: 'ready_for_review' | 'accepted'
  readonly reason: string
}

export interface SessionControlDelegationProposeAmendmentCommand {
  readonly operation: 'delegation-propose-amendment'
  readonly sessionId: string
  readonly delegationId: string
  readonly baseSpecificationRevision: number
  readonly specification: DelegationSpecificationInput
  readonly reason: string
}

export interface SessionControlDelegationAmendCommand {
  readonly operation: 'delegation-amend'
  readonly sessionId: string
  readonly delegationId: string
  readonly expectedSpecificationRevision: number
  readonly specification: DelegationSpecificationInput
  readonly reason: string
  readonly proposalId?: string
}

export type DelegationVerificationOutcome = 'passed' | 'failed' | 'inconclusive'

export interface SessionControlDelegationVerifyCommand {
  readonly operation: 'delegation-verify'
  readonly sessionId: string
  readonly delegationId: string
  readonly submissionRevision: number
  readonly outcome: DelegationVerificationOutcome
  readonly summary: string
  readonly evidence: readonly DelegationEvidenceInput[]
}

export type SessionControlCollaborationCommand =
  | SessionControlDelegationAcceptCommand
  | SessionControlDelegationCancelCommand
  | SessionControlDelegationClaimCommand
  | SessionControlDelegationConflictAcknowledgeCommand
  | SessionControlDelegationDependencyCommand
  | SessionControlDelegationProposeAmendmentCommand
  | SessionControlDelegationAmendCommand
  | SessionControlDelegationReopenCommand
  | SessionControlDelegationRequestRevisionCommand
  | SessionControlDelegationStateCommand
  | SessionControlDelegationSubmitCommand
  | SessionControlDelegationVerifyCommand
  | SessionControlReportCommand

export type SessionControlCollaborationOutcome =
  | {
      readonly operation:
        | 'delegation-submit'
        | 'delegation-request-revision'
        | 'delegation-accept'
        | 'delegation-reopen'
        | 'delegation-cancel'
        | 'delegation-state'
      readonly effect: 'delegation-updated'
      readonly sessionId: string
      readonly delegationId: string
      readonly parentSessionId: string
      readonly workerSessionId: string
      readonly delegationState: DelegationState
      readonly specificationRevision: number
      readonly submissionRevision: number
      readonly specificationChanged?: boolean
    }
  | {
      readonly operation: 'delegation-claim'
      readonly effect: 'delegation-claims-updated'
      readonly sessionId: string
      readonly delegationId: string
      readonly claimRevision: number
      readonly conflictIds: readonly string[]
    }
  | {
      readonly operation: 'delegation-conflict-acknowledge'
      readonly effect: 'delegation-conflict-acknowledged'
      readonly sessionId: string
      readonly delegationId: string
      readonly conflictId: string
      readonly acknowledgedAt: number
    }
  | {
      readonly operation: 'delegation-dependency'
      readonly effect: 'delegation-dependencies-updated'
      readonly sessionId: string
      readonly delegationId: string
      readonly delegationState: DelegationState
      readonly specificationRevision: number
      readonly dependencyCount: number
      readonly workerSessionId: string
    }
  | {
      readonly operation: 'delegation-propose-amendment'
      readonly effect: 'delegation-amendment-proposed'
      readonly sessionId: string
      readonly delegationId: string
      readonly proposalId: string
      readonly baseSpecificationRevision: number
    }
  | {
      readonly operation: 'delegation-amend'
      readonly effect: 'delegation-specification-amended'
      readonly sessionId: string
      readonly delegationId: string
      readonly delegationState: DelegationState
      readonly specificationRevision: number
      readonly appliedProposalId?: string
      readonly workerSessionId: string
    }
  | {
      readonly operation: 'delegation-verify'
      readonly effect: 'delegation-verification-recorded'
      readonly sessionId: string
      readonly delegationId: string
      readonly verificationId: string
      readonly submissionRevision: number
      readonly verificationOutcome: DelegationVerificationOutcome
      readonly createdAt: number
    }
  | {
      readonly operation: 'report'
      readonly effect: 'accepted-report'
      readonly sessionId: string
      readonly reportId: string
      readonly correlationId: string
      readonly targetSessionIds: readonly string[]
      readonly deliveryStates: readonly {
        readonly sessionId: string
        readonly status: 'pending' | 'delivered'
      }[]
    }

import type { DelegationSpecificationInput } from './session-lifecycle'
