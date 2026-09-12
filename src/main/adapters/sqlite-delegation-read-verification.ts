import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { selectedDelegationRowIds } from './sqlite-delegation-page'
import type { DelegationHistoryDescriptor, HistoryRow } from './sqlite-delegation-query-model'
import type { VerificationEvidenceRow, VerificationRow } from './sqlite-delegation-query-rows'

export function readDelegationVerificationHistory(
  sql: SqlClient.SqlClient,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const verificationIds = selectedDelegationRowIds(selected, 'verification')
  return Effect.gen(function* () {
    const verifications = verificationIds.length
      ? yield* sql<HistoryRow<VerificationRow>>`
          SELECT rowid AS cursor_id, id, submission_revision, specification_revision,
            verifier_session_id, verified_by, outcome, summary, created_at
          FROM delegation_verifications WHERE rowid IN ${sql.in(verificationIds)}
          ORDER BY created_at, rowid
        `
      : []
    const ids = verifications.map((row) => row.id)
    const verificationEvidence = ids.length
      ? yield* sql<VerificationEvidenceRow>`
          SELECT verification_id, kind, summary, reference, provenance_json
          FROM delegation_verification_evidence
          WHERE verification_id IN ${sql.in(ids)}
          ORDER BY verification_id, ordinal
        `
      : []
    return { verifications, verificationEvidence }
  })
}
