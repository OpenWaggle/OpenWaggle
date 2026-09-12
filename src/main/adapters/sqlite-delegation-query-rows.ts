import type { DelegationState } from '@shared/types/session-collaboration'

export interface DelegationSummaryRow {
  readonly delegation_id: string
  readonly parent_session_id: string
  readonly worker_session_id: string
  readonly state: DelegationState
  readonly specification_json: string
  readonly current_specification_revision: number
  readonly latest_submission_revision: number
  readonly created_at: number
  readonly updated_at: number
}

export interface SpecificationRow {
  readonly revision: number
  readonly specification_json: string
  readonly authored_by: string
  readonly reason: string | null
  readonly created_at: number
}

export interface SubmissionRow {
  readonly revision: number
  readonly specification_revision: number
  readonly summary: string
  readonly submitted_by: string
  readonly source_run_id: string | null
  readonly provenance: 'agent-submitted' | 'host-captured'
  readonly created_at: number
}

export interface EvidenceRow {
  readonly submission_revision: number
  readonly kind: string
  readonly summary: string
  readonly reference: string | null
  readonly provenance_json: string | null
}

export interface ReviewRow {
  readonly submission_revision: number
  readonly decision: 'revision_requested' | 'accepted'
  readonly feedback: string | null
  readonly reviewer_session_id: string
  readonly reviewed_by: string
  readonly specification_revision: number
  readonly created_at: number
}

export interface DependencyRow {
  readonly delegation_id: string
  readonly required_state: 'ready_for_review' | 'accepted'
  readonly current_state: DelegationState
}

export interface TransitionRow {
  readonly from_state: DelegationState
  readonly to_state: DelegationState
  readonly reason: string
  readonly actor_session_id: string
  readonly authored_by: string
  readonly created_at: number
}

export interface ClaimRevisionRow {
  readonly revision: number
  readonly actor_session_id: string
  readonly authored_by: string
  readonly reason: string
  readonly created_at: number
}

export interface ClaimRow {
  readonly revision: number
  readonly access: 'read' | 'write'
  readonly target_kind: 'workspace-file' | 'workspace-tree' | 'named-resource'
  readonly target_value: string
  readonly target_namespace: string | null
  readonly target_scope: 'project' | 'repository' | null
}

export interface UndeclaredWriteRow {
  readonly id: string
  readonly worker_session_id: string
  readonly run_id: string
  readonly path: string
  readonly claim_revision: number | null
  readonly provenance: 'isolated-turn-checkpoint'
  readonly created_at: number
}

export interface ConflictRow {
  readonly id: string
  readonly left_delegation_id: string
  readonly right_delegation_id: string
  readonly kind: 'live-overlap' | 'merge-overlap'
  readonly evidence_json: string
  readonly acknowledged_by: string | null
  readonly acknowledgement_reason: string | null
  readonly acknowledged_at: number | null
  readonly resolved_at: number | null
  readonly created_at: number
}

export interface AmendmentProposalRow {
  readonly id: string
  readonly base_specification_revision: number
  readonly specification_json: string
  readonly reason: string
  readonly actor_session_id: string
  readonly proposed_by: string
  readonly status: 'pending' | 'applied'
  readonly reviewed_by: string | null
  readonly applied_specification_revision: number | null
  readonly created_at: number
  readonly updated_at: number
}

export interface VerificationRow {
  readonly id: string
  readonly submission_revision: number
  readonly specification_revision: number
  readonly verifier_session_id: string
  readonly verified_by: string
  readonly outcome: 'passed' | 'failed' | 'inconclusive'
  readonly summary: string
  readonly created_at: number
}

export interface VerificationEvidenceRow {
  readonly verification_id: string
  readonly kind: string
  readonly summary: string
  readonly reference: string | null
  readonly provenance_json: string | null
}
