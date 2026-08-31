import type { SessionQueryOutcome } from '@shared/types/session-query'
import type {
  AmendmentProposalRow,
  ClaimRevisionRow,
  ClaimRow,
  ConflictRow,
  DelegationSummaryRow,
  DependencyRow,
  EvidenceRow,
  ReviewRow,
  SpecificationRow,
  SubmissionRow,
  TransitionRow,
  UndeclaredWriteRow,
  VerificationEvidenceRow,
  VerificationRow,
} from './sqlite-delegation-query-rows'
import { delegationSummary } from './sqlite-delegation-query-summary'
import { parseSessionJson } from './sqlite-session-query-support'

interface DelegationReadRows {
  readonly delegation: DelegationSummaryRow
  readonly specifications: readonly SpecificationRow[]
  readonly submissions: readonly SubmissionRow[]
  readonly evidence: readonly EvidenceRow[]
  readonly reviews: readonly ReviewRow[]
  readonly dependencies: readonly DependencyRow[]
  readonly transitions: readonly TransitionRow[]
  readonly claimRevisions: readonly ClaimRevisionRow[]
  readonly claims: readonly ClaimRow[]
  readonly undeclaredWrites: readonly UndeclaredWriteRow[]
  readonly conflicts: readonly ConflictRow[]
  readonly amendmentProposals: readonly AmendmentProposalRow[]
  readonly verifications: readonly VerificationRow[]
  readonly verificationEvidence: readonly VerificationEvidenceRow[]
}

function claimTarget(claim: ClaimRow) {
  return claim.target_kind === 'named-resource'
    ? {
        type: claim.target_kind,
        scope: claim.target_scope ?? ('project' as const),
        namespace: claim.target_namespace ?? '',
        name: claim.target_value,
      }
    : { type: claim.target_kind, path: claim.target_value }
}

export function delegationReadResponse(rows: DelegationReadRows) {
  return {
    operation: 'delegations-read',
    delegation: delegationSummary(rows.delegation),
    specifications: rows.specifications.map((row) => ({
      revision: row.revision,
      specification: parseSessionJson(row.specification_json),
      authoredBy: row.authored_by,
      ...(row.reason ? { reason: row.reason } : {}),
      createdAt: row.created_at,
    })),
    submissions: rows.submissions.map((row) => ({
      revision: row.revision,
      specificationRevision: row.specification_revision,
      summary: row.summary,
      submittedBy: row.submitted_by,
      ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
      provenance: row.provenance,
      createdAt: row.created_at,
      evidence: rows.evidence
        .filter((item) => item.submission_revision === row.revision)
        .map((item) => ({
          kind: item.kind,
          summary: item.summary,
          ...(item.reference ? { reference: item.reference } : {}),
          ...(item.provenance_json ? { provenance: parseSessionJson(item.provenance_json) } : {}),
        })),
    })),
    reviews: rows.reviews.map((row) => ({
      submissionRevision: row.submission_revision,
      decision: row.decision,
      ...(row.feedback ? { feedback: row.feedback } : {}),
      reviewerSessionId: row.reviewer_session_id,
      reviewedBy: row.reviewed_by,
      specificationRevision: row.specification_revision,
      createdAt: row.created_at,
    })),
    dependencies: rows.dependencies.map((row) => ({
      delegationId: row.delegation_id,
      requiredState: row.required_state,
      currentState: row.current_state,
    })),
    transitions: rows.transitions.map((row) => ({
      fromState: row.from_state,
      toState: row.to_state,
      reason: row.reason,
      actorSessionId: row.actor_session_id,
      authoredBy: row.authored_by,
      createdAt: row.created_at,
    })),
    claimRevisions: rows.claimRevisions.map((revision) => ({
      revision: revision.revision,
      actorSessionId: revision.actor_session_id,
      authoredBy: revision.authored_by,
      reason: revision.reason,
      createdAt: revision.created_at,
      claims: rows.claims
        .filter((claim) => claim.revision === revision.revision)
        .map((claim) => ({ access: claim.access, target: claimTarget(claim) })),
    })),
    undeclaredWrites: rows.undeclaredWrites.map((row) => ({
      observationId: row.id,
      workerSessionId: row.worker_session_id,
      runId: row.run_id,
      path: row.path,
      ...(row.claim_revision === null ? {} : { claimRevision: row.claim_revision }),
      provenance: row.provenance,
      createdAt: row.created_at,
    })),
    conflicts: rows.conflicts.map((row) => ({
      conflictId: row.id,
      leftDelegationId: row.left_delegation_id,
      rightDelegationId: row.right_delegation_id,
      kind: row.kind,
      evidence: parseSessionJson(row.evidence_json),
      ...(row.acknowledged_by ? { acknowledgedBy: row.acknowledged_by } : {}),
      ...(row.acknowledgement_reason ? { acknowledgementReason: row.acknowledgement_reason } : {}),
      ...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
      ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
      createdAt: row.created_at,
    })),
    amendmentProposals: rows.amendmentProposals.map((row) => ({
      proposalId: row.id,
      baseSpecificationRevision: row.base_specification_revision,
      specification: parseSessionJson(row.specification_json),
      reason: row.reason,
      actorSessionId: row.actor_session_id,
      proposedBy: row.proposed_by,
      status: row.status,
      ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
      ...(row.applied_specification_revision === null
        ? {}
        : { appliedSpecificationRevision: row.applied_specification_revision }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    verifications: rows.verifications.map((row) => ({
      verificationId: row.id,
      submissionRevision: row.submission_revision,
      specificationRevision: row.specification_revision,
      verifierSessionId: row.verifier_session_id,
      verifiedBy: row.verified_by,
      outcome: row.outcome,
      summary: row.summary,
      createdAt: row.created_at,
      evidence: rows.verificationEvidence
        .filter((item) => item.verification_id === row.id)
        .map((item) => ({
          kind: item.kind,
          summary: item.summary,
          ...(item.reference ? { reference: item.reference } : {}),
          ...(item.provenance_json ? { provenance: parseSessionJson(item.provenance_json) } : {}),
        })),
    })),
  } satisfies Extract<SessionQueryOutcome, { readonly operation: 'delegations-read' }>
}
