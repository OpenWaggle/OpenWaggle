import type { DelegationClaimTarget, DelegationState } from './session-collaboration'

export const DELEGATION_CONFLICT_KINDS = ['live-overlap', 'merge-overlap'] as const
export type DelegationConflictKind = (typeof DELEGATION_CONFLICT_KINDS)[number]

export const DELEGATION_CONFLICT_STATUSES = ['unacknowledged', 'acknowledged', 'resolved'] as const
export type DelegationConflictStatus = (typeof DELEGATION_CONFLICT_STATUSES)[number]

export interface DelegationQuerySummary {
  readonly delegationId: string
  readonly parentSessionId: string
  readonly workerSessionId: string
  readonly state: DelegationState
  readonly objective: string
  readonly currentSpecificationRevision: number
  readonly latestSubmissionRevision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface DelegationListQueryOutcome {
  readonly operation: 'delegations-list'
  readonly delegations: readonly DelegationQuerySummary[]
  readonly nextCursor?: string
}

export interface DelegationConflictQuerySummary {
  readonly conflictId: string
  readonly leftDelegationId: string
  readonly rightDelegationId: string
  readonly leftWorkerSessionId: string
  readonly rightWorkerSessionId: string
  readonly kind: DelegationConflictKind
  readonly status: DelegationConflictStatus
  readonly evidence: unknown
  readonly acknowledgedBy?: string
  readonly acknowledgementReason?: string
  readonly acknowledgedAt?: number
  readonly resolvedAt?: number
  readonly createdAt: number
}

export interface DelegationConflictsQueryOutcome {
  readonly operation: 'delegations-conflicts'
  readonly conflicts: readonly DelegationConflictQuerySummary[]
  readonly nextCursor?: string
}

export interface DelegationReadQueryOutcome {
  readonly operation: 'delegations-read'
  readonly delegation: DelegationQuerySummary
  readonly specifications: readonly {
    readonly revision: number
    readonly specification: unknown
    readonly authoredBy: string
    readonly reason?: string
    readonly createdAt: number
  }[]
  readonly submissions: readonly {
    readonly revision: number
    readonly specificationRevision: number
    readonly summary: string
    readonly submittedBy: string
    readonly sourceRunId?: string
    readonly provenance: 'agent-submitted' | 'host-captured'
    readonly createdAt: number
    readonly evidence: readonly {
      readonly kind: string
      readonly summary: string
      readonly reference?: string
      readonly provenance?: unknown
    }[]
  }[]
  readonly reviews: readonly {
    readonly submissionRevision: number
    readonly decision: 'revision_requested' | 'accepted'
    readonly feedback?: string
    readonly reviewerSessionId: string
    readonly reviewedBy: string
    readonly specificationRevision: number
    readonly createdAt: number
  }[]
  readonly dependencies: readonly {
    readonly delegationId: string
    readonly requiredState: 'ready_for_review' | 'accepted'
    readonly currentState: DelegationState
  }[]
  readonly transitions: readonly {
    readonly fromState: DelegationState
    readonly toState: DelegationState
    readonly reason: string
    readonly actorSessionId: string
    readonly authoredBy: string
    readonly createdAt: number
  }[]
  readonly claimRevisions: readonly {
    readonly revision: number
    readonly actorSessionId: string
    readonly authoredBy: string
    readonly reason: string
    readonly createdAt: number
    readonly claims: readonly {
      readonly access: 'read' | 'write'
      readonly target: DelegationClaimTarget
    }[]
  }[]
  readonly undeclaredWrites: readonly {
    readonly observationId: string
    readonly workerSessionId: string
    readonly runId: string
    readonly path: string
    readonly claimRevision?: number
    readonly provenance: 'isolated-turn-checkpoint'
    readonly createdAt: number
  }[]
  readonly conflicts: readonly {
    readonly conflictId: string
    readonly leftDelegationId: string
    readonly rightDelegationId: string
    readonly kind: DelegationConflictKind
    readonly evidence: unknown
    readonly acknowledgedBy?: string
    readonly acknowledgementReason?: string
    readonly acknowledgedAt?: number
    readonly resolvedAt?: number
    readonly createdAt: number
  }[]
  readonly amendmentProposals: readonly {
    readonly proposalId: string
    readonly baseSpecificationRevision: number
    readonly specification: unknown
    readonly reason: string
    readonly actorSessionId: string
    readonly proposedBy: string
    readonly status: 'pending' | 'applied'
    readonly reviewedBy?: string
    readonly appliedSpecificationRevision?: number
    readonly createdAt: number
    readonly updatedAt: number
  }[]
  readonly verifications: readonly {
    readonly verificationId: string
    readonly submissionRevision: number
    readonly specificationRevision: number
    readonly verifierSessionId: string
    readonly verifiedBy: string
    readonly outcome: 'passed' | 'failed' | 'inconclusive'
    readonly summary: string
    readonly createdAt: number
    readonly evidence: readonly {
      readonly kind: string
      readonly summary: string
      readonly reference?: string
      readonly provenance?: unknown
    }[]
  }[]
}
