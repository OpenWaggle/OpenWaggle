import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { selectedDelegationRowIds } from './sqlite-delegation-page'
import type { DelegationHistoryDescriptor } from './sqlite-delegation-query-model'
import {
  amendmentProposalRowSchema,
  claimRevisionRowSchema,
  claimRowSchema,
  conflictRowSchema,
  historyRowSchema,
  undeclaredWriteRowSchema,
} from './sqlite-delegation-query-rows'
import { decodeSqlRows } from './sqlite-row-schema'

function readClaimHistory(
  sql: SqlClient.SqlClient,
  delegationId: string,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const claimIds = selectedDelegationRowIds(selected, 'claim')
  return Effect.gen(function* () {
    const claimRevisions = claimIds.length
      ? yield* sql`
          SELECT rowid AS cursor_id, revision, actor_session_id, authored_by, reason, created_at
          FROM delegation_claim_revisions WHERE rowid IN ${sql.in(claimIds)}
          ORDER BY created_at, rowid
        `.pipe(
          Effect.flatMap(
            decodeSqlRows(historyRowSchema(claimRevisionRowSchema), 'delegation_claim_revisions'),
          ),
        )
      : []
    const revisions = claimRevisions.map((row) => row.revision)
    const claims = revisions.length
      ? yield* sql`
          SELECT revision, access, target_kind, target_value, target_namespace, target_scope
          FROM delegation_scope_claims
          WHERE delegation_id = ${delegationId} AND revision IN ${sql.in(revisions)}
          ORDER BY revision, ordinal
        `.pipe(Effect.flatMap(decodeSqlRows(claimRowSchema, 'delegation_scope_claims')))
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
      ? yield* sql`
          SELECT rowid AS cursor_id, id, worker_session_id, run_id, path, claim_revision,
            provenance, created_at
          FROM delegation_undeclared_writes WHERE rowid IN ${sql.in(undeclaredWriteIds)}
          ORDER BY created_at, rowid
        `.pipe(
          Effect.flatMap(
            decodeSqlRows(
              historyRowSchema(undeclaredWriteRowSchema),
              'delegation_undeclared_writes',
            ),
          ),
        )
      : []
    const conflicts = conflictIds.length
      ? yield* sql`
          SELECT rowid AS cursor_id, id, left_delegation_id, right_delegation_id, kind,
            evidence_json,
            acknowledged_by, acknowledgement_reason, acknowledged_at, resolved_at, created_at
          FROM delegation_conflicts WHERE rowid IN ${sql.in(conflictIds)}
          ORDER BY created_at, rowid
        `.pipe(
          Effect.flatMap(
            decodeSqlRows(historyRowSchema(conflictRowSchema), 'delegation_conflicts'),
          ),
        )
      : []
    const amendmentProposals = amendmentIds.length
      ? yield* sql`
          SELECT rowid AS cursor_id, id, base_specification_revision, specification_json, reason,
            actor_session_id, proposed_by, status, reviewed_by,
            applied_specification_revision, created_at, updated_at
          FROM delegation_amendment_proposals WHERE rowid IN ${sql.in(amendmentIds)}
          ORDER BY created_at, rowid
        `.pipe(
          Effect.flatMap(
            decodeSqlRows(
              historyRowSchema(amendmentProposalRowSchema),
              'delegation_amendment_proposals',
            ),
          ),
        )
      : []
    return { claimRevisions, claims, undeclaredWrites, conflicts, amendmentProposals }
  })
}
