import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import type {
  DelegationHistoryDescriptor,
  DelegationHistoryHighWater,
  DelegationHistoryHighWaterRow,
  DelegationReadCursor,
} from './sqlite-delegation-query-model'
import type { DelegationSummaryRow } from './sqlite-delegation-query-rows'
import { authorizedSessionScope } from './sqlite-session-query-support'

export function readDelegationSummary(sql: SqlClient.SqlClient, delegationId: string) {
  return Effect.gen(function* () {
    const delegations = yield* sql<DelegationSummaryRow>`
      SELECT contracts.id AS delegation_id,
        contracts.parent_session_id,
        contracts.child_session_id AS worker_session_id,
        contracts.state,
        current_specification.specification_json,
        contracts.current_specification_revision,
        COALESCE(MAX(submissions.revision), 0) AS latest_submission_revision,
        contracts.created_at,
        contracts.updated_at
      FROM delegation_contracts AS contracts
      JOIN delegation_specifications AS current_specification
        ON current_specification.delegation_id = contracts.id
        AND current_specification.revision = contracts.current_specification_revision
      LEFT JOIN delegation_submissions AS submissions ON submissions.delegation_id = contracts.id
      WHERE contracts.id = ${delegationId}
      GROUP BY contracts.id
      LIMIT 1
    `
    return delegations[0]
  })
}

export function readDelegationHistoryHighWater(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* sql<DelegationHistoryHighWaterRow>`
      SELECT
        COALESCE((SELECT MAX(rowid) FROM delegation_amendment_proposals), 0) AS amendment,
        COALESCE((SELECT MAX(rowid) FROM delegation_claim_revisions), 0) AS claim,
        COALESCE((SELECT MAX(rowid) FROM delegation_conflicts), 0) AS conflict,
        COALESCE((SELECT MAX(rowid) FROM delegation_reviews), 0) AS review,
        COALESCE((SELECT MAX(rowid) FROM delegation_specifications), 0) AS specification,
        COALESCE((SELECT MAX(rowid) FROM delegation_submissions), 0) AS submission,
        COALESCE((SELECT MAX(rowid) FROM delegation_state_transitions), 0) AS transition,
        COALESCE((SELECT MAX(rowid) FROM delegation_undeclared_writes), 0) AS undeclared_write,
        COALESCE((SELECT MAX(rowid) FROM delegation_verifications), 0) AS verification
    `
    const row = rows[0]
    if (!row) throw new Error('Expected Delegation history high-water marks.')
    return {
      amendment: row.amendment,
      claim: row.claim,
      conflict: row.conflict,
      review: row.review,
      specification: row.specification,
      submission: row.submission,
      transition: row.transition,
      'undeclared-write': row.undeclared_write,
      verification: row.verification,
    } satisfies DelegationHistoryHighWater
  })
}

export function readDelegationHistoryDescriptors(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  delegationId: string,
  cursor: DelegationReadCursor | null,
  highWater: DelegationHistoryHighWater,
  limit: number,
) {
  const allowed = authorizedSessionScope(authority)
  return sql<DelegationHistoryDescriptor>`
    WITH history(kind, cursor_id, created_at, estimated_bytes) AS (
      SELECT 'specification', rowid, created_at,
        length(CAST(specification_json AS BLOB)) + COALESCE(length(CAST(reason AS BLOB)), 0) + 8192
      FROM delegation_specifications
      WHERE delegation_id = ${delegationId} AND rowid <= ${highWater.specification}
      UNION ALL
      SELECT 'submission', submissions.rowid, submissions.created_at,
        length(CAST(submissions.summary AS BLOB)) + 8192 + COALESCE((
          SELECT SUM(length(CAST(summary AS BLOB)) +
            COALESCE(length(CAST(reference AS BLOB)), 0) +
            COALESCE(length(CAST(provenance_json AS BLOB)), 0) + 1024)
          FROM delegation_evidence
          WHERE delegation_id = ${delegationId}
            AND submission_revision = submissions.revision
        ), 0)
      FROM delegation_submissions AS submissions
      WHERE delegation_id = ${delegationId} AND submissions.rowid <= ${highWater.submission}
      UNION ALL
      SELECT 'review', rowid, created_at,
        COALESCE(length(CAST(feedback AS BLOB)), 0) + 8192
      FROM delegation_reviews
      WHERE delegation_id = ${delegationId} AND rowid <= ${highWater.review}
      UNION ALL
      SELECT 'transition', rowid, created_at, length(CAST(reason AS BLOB)) + 8192
      FROM delegation_state_transitions
      WHERE delegation_id = ${delegationId} AND rowid <= ${highWater.transition}
      UNION ALL
      SELECT 'claim', revisions.rowid, revisions.created_at,
        length(CAST(revisions.reason AS BLOB)) + 8192 + COALESCE((
          SELECT SUM(length(CAST(target_value AS BLOB)) +
            COALESCE(length(CAST(target_namespace AS BLOB)), 0) +
            COALESCE(length(CAST(target_scope AS BLOB)), 0) + 1024)
          FROM delegation_scope_claims
          WHERE delegation_id = ${delegationId} AND revision = revisions.revision
        ), 0)
      FROM delegation_claim_revisions AS revisions
      WHERE delegation_id = ${delegationId} AND revisions.rowid <= ${highWater.claim}
      UNION ALL
      SELECT 'undeclared-write', rowid, created_at, length(CAST(path AS BLOB)) + 8192
      FROM delegation_undeclared_writes
      WHERE delegation_id = ${delegationId} AND rowid <= ${highWater['undeclared-write']}
      UNION ALL
      SELECT 'conflict', conflicts.rowid, conflicts.created_at,
        length(CAST(conflicts.evidence_json AS BLOB)) +
          COALESCE(length(CAST(conflicts.acknowledgement_reason AS BLOB)), 0) + 8192
      FROM delegation_conflicts AS conflicts
      JOIN delegation_contracts AS left_contract ON left_contract.id = conflicts.left_delegation_id
      JOIN delegation_contracts AS right_contract
        ON right_contract.id = conflicts.right_delegation_id
      JOIN sessions AS left_worker ON left_worker.id = left_contract.child_session_id
      JOIN sessions AS right_worker ON right_worker.id = right_contract.child_session_id
      LEFT JOIN session_spawn_lineage AS left_lineage
        ON left_lineage.child_session_id = left_worker.id
      LEFT JOIN session_spawn_lineage AS right_lineage
        ON right_lineage.child_session_id = right_worker.id
      WHERE (conflicts.left_delegation_id = ${delegationId}
          OR conflicts.right_delegation_id = ${delegationId})
        AND conflicts.rowid <= ${highWater.conflict}
        AND (${allowed.all} = 1 OR (
          (left_worker.project_path IN ${sql.in(allowed.projectPaths)}
            OR left_worker.id IN ${sql.in(allowed.sessionIds)}
            OR COALESCE(left_lineage.hive_root_session_id, left_worker.id)
              IN ${sql.in(allowed.hiveRootSessionIds)})
          AND
          (right_worker.project_path IN ${sql.in(allowed.projectPaths)}
            OR right_worker.id IN ${sql.in(allowed.sessionIds)}
            OR COALESCE(right_lineage.hive_root_session_id, right_worker.id)
              IN ${sql.in(allowed.hiveRootSessionIds)})
        ))
      UNION ALL
      SELECT 'amendment', rowid, created_at,
        length(CAST(specification_json AS BLOB)) + length(CAST(reason AS BLOB)) + 8192
      FROM delegation_amendment_proposals
      WHERE delegation_id = ${delegationId} AND rowid <= ${highWater.amendment}
      UNION ALL
      SELECT 'verification', verifications.rowid, verifications.created_at,
        length(CAST(verifications.summary AS BLOB)) + 8192 + COALESCE((
          SELECT SUM(length(CAST(evidence.summary AS BLOB)) +
            COALESCE(length(CAST(evidence.reference AS BLOB)), 0) +
            COALESCE(length(CAST(evidence.provenance_json AS BLOB)), 0) + 1024)
          FROM delegation_verification_evidence AS evidence
          WHERE evidence.verification_id = verifications.id
        ), 0)
      FROM delegation_verifications AS verifications
      WHERE delegation_id = ${delegationId} AND verifications.rowid <= ${highWater.verification}
    )
    SELECT kind, cursor_id, created_at, estimated_bytes
    FROM history
    WHERE (${cursor?.createdAt ?? null} IS NULL
      OR created_at > ${cursor?.createdAt ?? null}
      OR (created_at = ${cursor?.createdAt ?? null} AND kind > ${cursor?.kind ?? null})
      OR (created_at = ${cursor?.createdAt ?? null} AND kind = ${cursor?.kind ?? null}
        AND cursor_id > ${cursor?.cursorId ?? null}))
    ORDER BY created_at, kind, cursor_id
    LIMIT ${limit + 1}
  `
}
