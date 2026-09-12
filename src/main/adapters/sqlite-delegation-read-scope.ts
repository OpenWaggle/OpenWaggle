import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { selectedDelegationRowIds } from './sqlite-delegation-page'
import type { DelegationHistoryDescriptor, HistoryRow } from './sqlite-delegation-query-model'
import type {
  AmendmentProposalRow,
  ClaimRevisionRow,
  ClaimRow,
  ConflictRow,
  UndeclaredWriteRow,
} from './sqlite-delegation-query-rows'

function readClaimHistory(
  sql: SqlClient.SqlClient,
  delegationId: string,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const claimIds = selectedDelegationRowIds(selected, 'claim')
  return Effect.gen(function* () {
    const claimRevisions = claimIds.length
      ? yield* sql<HistoryRow<ClaimRevisionRow>>`
          SELECT rowid AS cursor_id, revision, actor_session_id, authored_by, reason, created_at
          FROM delegation_claim_revisions WHERE rowid IN ${sql.in(claimIds)}
          ORDER BY created_at, rowid
        `
      : []
    const revisions = claimRevisions.map((row) => row.revision)
    const claims = revisions.length
      ? yield* sql<ClaimRow>`
          SELECT revision, access, target_kind, target_value, target_namespace, target_scope
          FROM delegation_scope_claims
          WHERE delegation_id = ${delegationId} AND revision IN ${sql.in(revisions)}
          ORDER BY revision, ordinal
        `
      : []
    return { claimRevisions, claims }
  })
}

export function readDelegationScopeHistory(
  sql: SqlClient.SqlClient,
  delegationId: string,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const undeclaredWriteIds = selectedDelegationRowIds(selected, 'undeclared-write')
  const conflictIds = selectedDelegationRowIds(selected, 'conflict')
  const amendmentIds = selectedDelegationRowIds(selected, 'amendment')
  return Effect.gen(function* () {
    const { claimRevisions, claims } = yield* readClaimHistory(sql, delegationId, selected)
    const undeclaredWrites = undeclaredWriteIds.length
      ? yield* sql<HistoryRow<UndeclaredWriteRow>>`
          SELECT rowid AS cursor_id, id, worker_session_id, run_id, path, claim_revision,
            provenance, created_at
          FROM delegation_undeclared_writes WHERE rowid IN ${sql.in(undeclaredWriteIds)}
          ORDER BY created_at, rowid
        `
      : []
    const conflicts = conflictIds.length
      ? yield* sql<HistoryRow<ConflictRow>>`
          SELECT rowid AS cursor_id, id, left_delegation_id, right_delegation_id, kind,
            evidence_json,
            acknowledged_by, acknowledgement_reason, acknowledged_at, resolved_at, created_at
          FROM delegation_conflicts WHERE rowid IN ${sql.in(conflictIds)}
          ORDER BY created_at, rowid
        `
      : []
    const amendmentProposals = amendmentIds.length
      ? yield* sql<HistoryRow<AmendmentProposalRow>>`
          SELECT rowid AS cursor_id, id, base_specification_revision, specification_json, reason,
            actor_session_id, proposed_by, status, reviewed_by,
            applied_specification_revision, created_at, updated_at
          FROM delegation_amendment_proposals WHERE rowid IN ${sql.in(amendmentIds)}
          ORDER BY created_at, rowid
        `
      : []
    return { claimRevisions, claims, undeclaredWrites, conflicts, amendmentProposals }
  })
}
