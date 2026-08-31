import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { selectedDelegationRowIds } from './sqlite-delegation-page'
import type { DelegationHistoryDescriptor, HistoryRow } from './sqlite-delegation-query-model'
import type {
  DependencyRow,
  EvidenceRow,
  ReviewRow,
  SpecificationRow,
  SubmissionRow,
  TransitionRow,
} from './sqlite-delegation-query-rows'

function readSubmissionHistory(
  sql: SqlClient.SqlClient,
  delegationId: string,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const submissionIds = selectedDelegationRowIds(selected, 'submission')
  return Effect.gen(function* () {
    const submissions = submissionIds.length
      ? yield* sql<HistoryRow<SubmissionRow>>`
          SELECT rowid AS cursor_id, revision, specification_revision, summary, submitted_by,
            source_run_id, provenance, created_at
          FROM delegation_submissions WHERE rowid IN ${sql.in(submissionIds)}
          ORDER BY created_at, rowid
        `
      : []
    const submissionRevisions = submissions.map((row) => row.revision)
    const evidence = submissionRevisions.length
      ? yield* sql<EvidenceRow>`
          SELECT submission_revision, kind, summary, reference, provenance_json
          FROM delegation_evidence
          WHERE delegation_id = ${delegationId}
            AND submission_revision IN ${sql.in(submissionRevisions)}
          ORDER BY submission_revision, ordinal
        `
      : []
    return { submissions, evidence }
  })
}

export function readDelegationPrimaryHistory(
  sql: SqlClient.SqlClient,
  delegationId: string,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const specificationIds = selectedDelegationRowIds(selected, 'specification')
  const reviewIds = selectedDelegationRowIds(selected, 'review')
  const transitionIds = selectedDelegationRowIds(selected, 'transition')
  return Effect.gen(function* () {
    const specifications = specificationIds.length
      ? yield* sql<HistoryRow<SpecificationRow>>`
          SELECT rowid AS cursor_id, revision, specification_json, authored_by, reason, created_at
          FROM delegation_specifications WHERE rowid IN ${sql.in(specificationIds)}
          ORDER BY created_at, rowid
        `
      : []
    const { submissions, evidence } = yield* readSubmissionHistory(sql, delegationId, selected)
    const reviews = reviewIds.length
      ? yield* sql<HistoryRow<ReviewRow>>`
          SELECT rowid AS cursor_id, submission_revision, decision, feedback, reviewer_session_id,
            reviewed_by, specification_revision, created_at
          FROM delegation_reviews WHERE rowid IN ${sql.in(reviewIds)}
          ORDER BY created_at, rowid
        `
      : []
    const dependencies = yield* sql<DependencyRow>`
      SELECT dependencies.dependency_delegation_id AS delegation_id,
        dependencies.required_state, required.state AS current_state
      FROM delegation_dependencies AS dependencies
      JOIN delegation_contracts AS required ON required.id = dependencies.dependency_delegation_id
      WHERE dependencies.delegation_id = ${delegationId}
      ORDER BY dependencies.dependency_delegation_id
    `
    const transitions = transitionIds.length
      ? yield* sql<HistoryRow<TransitionRow>>`
          SELECT rowid AS cursor_id, from_state, to_state, reason, actor_session_id,
            authored_by, created_at
          FROM delegation_state_transitions WHERE rowid IN ${sql.in(transitionIds)}
          ORDER BY created_at, rowid
        `
      : []
    return { specifications, submissions, evidence, reviews, dependencies, transitions }
  })
}
