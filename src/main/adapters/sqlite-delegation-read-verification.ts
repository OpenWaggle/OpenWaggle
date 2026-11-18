import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { selectedDelegationRowIds } from './sqlite-delegation-page'
import type { DelegationHistoryDescriptor } from './sqlite-delegation-query-model'
import {
  historyRowSchema,
  verificationEvidenceRowSchema,
  verificationRowSchema,
} from './sqlite-delegation-query-rows'
import { decodeSqlRows } from './sqlite-row-schema'

export function readDelegationVerificationHistory(
  sql: SqlClient.SqlClient,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const verificationIds = selectedDelegationRowIds(selected, 'verification')
  return Effect.gen(function* () {
    const verifications = verificationIds.length
      ? yield* sql`
          SELECT rowid AS cursor_id, id, submission_revision, specification_revision,
            verifier_session_id, verified_by, outcome, summary, created_at
          FROM delegation_verifications WHERE rowid IN ${sql.in(verificationIds)}
          ORDER BY created_at, rowid
        `.pipe(
          Effect.flatMap(
            decodeSqlRows(historyRowSchema(verificationRowSchema), 'delegation_verifications'),
          ),
        )
      : []
    const ids = verifications.map((row) => row.id)
    const verificationEvidence = ids.length
      ? yield* sql`
          SELECT verification_id, kind, summary, reference, provenance_json
          FROM delegation_verification_evidence
          WHERE verification_id IN ${sql.in(ids)}
          ORDER BY verification_id, ordinal
        `.pipe(
          Effect.flatMap(
            decodeSqlRows(verificationEvidenceRowSchema, 'delegation_verification_evidence'),
          ),
        )
      : []
    return { verifications, verificationEvidence }
  })
}
