import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { DelegationState } from '@shared/types/session-collaboration'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { delegationListResponse } from './sqlite-delegation-list-response'
import { delegationReadResponse } from './sqlite-delegation-query-response'
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
import {
  authorizedSessionScope,
  decodeSessionQueryCursor,
  invalidSessionQueryCursor,
  sessionQueryResponse,
} from './sqlite-session-query-support'

type DelegationsListRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'delegations-list' }>
}

function listCursor(request: DelegationsListRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return 'invalid' as const
  if (!cursor) return null
  return typeof cursor.updatedAt === 'number' && typeof cursor.delegationId === 'string'
    ? { updatedAt: cursor.updatedAt, delegationId: cursor.delegationId }
    : ('invalid' as const)
}

export function listDelegations(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DelegationsListRequest,
) {
  const cursor = listCursor(request)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const allowed = authorizedSessionScope(authority)
  const projectPath = request.query.projectPath ?? null
  const parentSessionId = request.query.parentSessionId ?? null
  const workingPath = request.query.workingPath ?? null
  const workerSessionId = request.query.workerSessionId ?? null
  const statesSelected = request.query.states?.length ? 1 : 0
  const states: readonly DelegationState[] = request.query.states?.length
    ? request.query.states
    : ['working']
  const cursorUpdatedAt = cursor?.updatedAt ?? null
  const cursorDelegationId = cursor?.delegationId ?? null
  return Effect.gen(function* () {
    const rows = yield* sql<DelegationSummaryRow>`
      SELECT contracts.id AS delegation_id,
        contracts.parent_session_id,
        contracts.child_session_id AS worker_session_id,
        contracts.state,
        specifications.specification_json,
        contracts.current_specification_revision,
        COALESCE(MAX(submissions.revision), 0) AS latest_submission_revision,
        contracts.created_at,
        contracts.updated_at
      FROM delegation_contracts AS contracts
      JOIN delegation_specifications AS specifications
        ON specifications.delegation_id = contracts.id
        AND specifications.revision = contracts.current_specification_revision
      JOIN sessions AS workers ON workers.id = contracts.child_session_id
      LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = workers.id
      LEFT JOIN delegation_submissions AS submissions ON submissions.delegation_id = contracts.id
      WHERE (${projectPath} IS NULL OR workers.project_path = ${projectPath})
        AND (${workingPath} IS NULL OR EXISTS (
          SELECT 1 FROM session_workspace_bindings AS delegation_binding
          JOIN workspace_resources AS delegation_workspace
            ON delegation_workspace.id = delegation_binding.workspace_id
          WHERE delegation_binding.session_id = workers.id
            AND delegation_workspace.working_path = ${workingPath}
        ))
        AND (${parentSessionId} IS NULL OR contracts.parent_session_id = ${parentSessionId})
        AND (${workerSessionId} IS NULL OR contracts.child_session_id = ${workerSessionId})
        AND (${statesSelected} = 0 OR contracts.state IN ${sql.in(states)})
        AND (${cursorUpdatedAt} IS NULL
          OR contracts.updated_at < ${cursorUpdatedAt}
          OR (contracts.updated_at = ${cursorUpdatedAt}
            AND contracts.id < ${cursorDelegationId}))
        AND (
          ${allowed.all} = 1
          OR workers.project_path IN ${sql.in(allowed.projectPaths)}
          OR workers.id IN ${sql.in(allowed.sessionIds)}
          OR COALESCE(lineage.hive_root_session_id, workers.id)
            IN ${sql.in(allowed.hiveRootSessionIds)}
        )
      GROUP BY contracts.id
      ORDER BY contracts.updated_at DESC, contracts.id DESC
      LIMIT ${request.query.limit + 1}
    `
    return delegationListResponse(request, rows)
  })
}

function readDelegationCoordinationRows(
  sql: SqlClient.SqlClient,
  allowed: ReturnType<typeof authorizedSessionScope>,
  delegationId: string,
) {
  return Effect.gen(function* () {
    const transitions = yield* sql<TransitionRow>`
      SELECT from_state, to_state, reason, actor_session_id, authored_by, created_at
      FROM delegation_state_transitions WHERE delegation_id = ${delegationId}
      ORDER BY created_at, id
    `
    const claimRevisions = yield* sql<ClaimRevisionRow>`
      SELECT revision, actor_session_id, authored_by, reason, created_at
      FROM delegation_claim_revisions WHERE delegation_id = ${delegationId}
      ORDER BY revision
    `
    const claims = yield* sql<ClaimRow>`
      SELECT revision, access, target_kind, target_value, target_namespace, target_scope
      FROM delegation_scope_claims WHERE delegation_id = ${delegationId}
      ORDER BY revision, ordinal
    `
    const undeclaredWrites = yield* sql<UndeclaredWriteRow>`
      SELECT id, worker_session_id, run_id, path, claim_revision, provenance, created_at
      FROM delegation_undeclared_writes WHERE delegation_id = ${delegationId}
      ORDER BY created_at, id
    `
    const conflicts = yield* sql<ConflictRow>`
      SELECT conflicts.id, conflicts.left_delegation_id, conflicts.right_delegation_id,
        conflicts.kind, conflicts.evidence_json, conflicts.acknowledged_by,
        conflicts.acknowledgement_reason, conflicts.acknowledged_at,
        conflicts.resolved_at, conflicts.created_at
      FROM delegation_conflicts AS conflicts
      JOIN delegation_contracts AS left_contract
        ON left_contract.id = conflicts.left_delegation_id
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
      ORDER BY conflicts.created_at, conflicts.id
    `
    const amendmentProposals = yield* sql<AmendmentProposalRow>`
      SELECT id, base_specification_revision, specification_json, reason,
        actor_session_id, proposed_by, status, reviewed_by,
        applied_specification_revision, created_at, updated_at
      FROM delegation_amendment_proposals WHERE delegation_id = ${delegationId}
      ORDER BY created_at, id
    `
    const verifications = yield* sql<VerificationRow>`
      SELECT id, submission_revision, specification_revision, verifier_session_id,
        verified_by, outcome, summary, created_at
      FROM delegation_verifications WHERE delegation_id = ${delegationId}
      ORDER BY created_at, id
    `
    const verificationEvidence = yield* sql<VerificationEvidenceRow>`
      SELECT evidence.verification_id, evidence.kind, evidence.summary,
        evidence.reference, evidence.provenance_json
      FROM delegation_verification_evidence AS evidence
      JOIN delegation_verifications AS verifications ON verifications.id = evidence.verification_id
      WHERE verifications.delegation_id = ${delegationId}
      ORDER BY evidence.verification_id, evidence.ordinal
    `
    return {
      transitions,
      claimRevisions,
      claims,
      undeclaredWrites,
      conflicts,
      amendmentProposals,
      verifications,
      verificationEvidence,
    }
  })
}

function readDelegationRows(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  delegationId: string,
) {
  const allowed = authorizedSessionScope(authority)
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
    if (!delegations[0]) return undefined
    const specifications = yield* sql<SpecificationRow>`
      SELECT revision, specification_json, authored_by, reason, created_at
      FROM delegation_specifications WHERE delegation_id = ${delegationId}
      ORDER BY revision
    `
    const submissions = yield* sql<SubmissionRow>`
      SELECT revision, specification_revision, summary, submitted_by,
        source_run_id, provenance, created_at
      FROM delegation_submissions WHERE delegation_id = ${delegationId}
      ORDER BY revision
    `
    const evidence = yield* sql<EvidenceRow>`
      SELECT submission_revision, kind, summary, reference, provenance_json
      FROM delegation_evidence WHERE delegation_id = ${delegationId}
      ORDER BY submission_revision, ordinal
    `
    const reviews = yield* sql<ReviewRow>`
      SELECT submission_revision, decision, feedback, reviewer_session_id,
        reviewed_by, specification_revision, created_at
      FROM delegation_reviews WHERE delegation_id = ${delegationId}
      ORDER BY created_at, id
    `
    const dependencies = yield* sql<DependencyRow>`
      SELECT dependencies.dependency_delegation_id AS delegation_id,
        dependencies.required_state,
        required.state AS current_state
      FROM delegation_dependencies AS dependencies
      JOIN delegation_contracts AS required ON required.id = dependencies.dependency_delegation_id
      WHERE dependencies.delegation_id = ${delegationId}
      ORDER BY dependencies.dependency_delegation_id
    `
    const coordination = yield* readDelegationCoordinationRows(sql, allowed, delegationId)
    return {
      delegation: delegations[0],
      specifications,
      submissions,
      evidence,
      reviews,
      dependencies,
      ...coordination,
    }
  })
}

export function readDelegation(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: SessionQueryRequest,
) {
  if (request.query.operation !== 'delegations-read') throw new Error('Expected Delegation read.')
  const delegationId = request.query.delegationId
  return Effect.gen(function* () {
    const rows = yield* readDelegationRows(sql, authority, delegationId)
    if (!rows) {
      return sessionQueryResponse(request, {
        operation: 'delegations-read',
        error: { code: 'delegation_not_found', message: 'Delegation not found.' },
      })
    }
    return sessionQueryResponse(request, delegationReadResponse(rows))
  })
}
