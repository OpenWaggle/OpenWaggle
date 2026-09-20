import type { SessionQueryRequest } from '@shared/types/session-query'
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

export type DelegationsListRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'delegations-list' }>
}

export type DelegationReadRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'delegations-read' }>
}

export type DelegationHistoryKind =
  | 'amendment'
  | 'claim'
  | 'conflict'
  | 'review'
  | 'specification'
  | 'submission'
  | 'transition'
  | 'undeclared-write'
  | 'verification'

export interface DelegationHistoryDescriptor {
  readonly kind: DelegationHistoryKind
  readonly cursor_id: number
  readonly created_at: number
  readonly estimated_bytes: number
}

export interface DelegationReadCursor {
  readonly createdAt: number
  readonly kind: DelegationHistoryKind
  readonly cursorId: number
  readonly through: DelegationHistoryHighWater
}

export type DelegationHistoryHighWater = Readonly<Record<DelegationHistoryKind, number>>

export interface DelegationHistoryHighWaterRow {
  readonly amendment: number
  readonly claim: number
  readonly conflict: number
  readonly review: number
  readonly specification: number
  readonly submission: number
  readonly transition: number
  readonly undeclared_write: number
  readonly verification: number
}

export type HistoryRow<T> = T & { readonly cursor_id: number }

export interface DelegationHistoryRows {
  readonly delegation: DelegationSummaryRow
  readonly specifications: readonly HistoryRow<SpecificationRow>[]
  readonly submissions: readonly HistoryRow<SubmissionRow>[]
  readonly evidence: readonly EvidenceRow[]
  readonly reviews: readonly HistoryRow<ReviewRow>[]
  readonly dependencies: readonly DependencyRow[]
  readonly transitions: readonly HistoryRow<TransitionRow>[]
  readonly claimRevisions: readonly HistoryRow<ClaimRevisionRow>[]
  readonly claims: readonly ClaimRow[]
  readonly undeclaredWrites: readonly HistoryRow<UndeclaredWriteRow>[]
  readonly conflicts: readonly HistoryRow<ConflictRow>[]
  readonly amendmentProposals: readonly HistoryRow<AmendmentProposalRow>[]
  readonly verifications: readonly HistoryRow<VerificationRow>[]
  readonly verificationEvidence: readonly VerificationEvidenceRow[]
}

export const DEFAULT_DELEGATION_HISTORY_LIMIT = 50

export const DELEGATION_HISTORY_KINDS: readonly DelegationHistoryKind[] = [
  'amendment',
  'claim',
  'conflict',
  'review',
  'specification',
  'submission',
  'transition',
  'undeclared-write',
  'verification',
]
