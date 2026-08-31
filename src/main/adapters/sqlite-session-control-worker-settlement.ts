import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'

interface WorkerDelegationRow {
  readonly id: string
  readonly parent_session_id: string
  readonly state: string
  readonly current_specification_revision: number
  readonly latest_submission_revision: number
}

const HOST_CAPTURED_RESULT_LIMIT = 100_000

function loadWorkerDelegation(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql<WorkerDelegationRow>`
    SELECT contracts.id, contracts.parent_session_id, contracts.state,
      contracts.current_specification_revision,
      COALESCE(MAX(submissions.revision), 0) AS latest_submission_revision
    FROM delegation_contracts AS contracts
    LEFT JOIN delegation_submissions AS submissions ON submissions.delegation_id = contracts.id
    WHERE contracts.child_session_id = ${sessionId}
    GROUP BY contracts.id
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function insertOrchestrationUpdate(
  sql: SqlClient.SqlClient,
  input: {
    readonly updateId: string
    readonly contract: WorkerDelegationRow
    readonly settlement: Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0]
    readonly state: 'ready_for_review' | 'needs_attention'
    readonly summary: string
    readonly now: number
  },
) {
  return sql`
    INSERT INTO session_orchestration_updates (
      id, parent_session_id, worker_session_id, delegation_id, source_run_id,
      state, summary, status, created_at
    ) VALUES (
      ${input.updateId}, ${input.contract.parent_session_id}, ${input.settlement.sessionId},
      ${input.contract.id}, ${input.settlement.runId}, ${input.state}, ${input.summary},
      ${'pending'}, ${input.now}
    )
  `
}

function settleUnsuccessfulWorker(
  sql: SqlClient.SqlClient,
  input: {
    readonly contract: WorkerDelegationRow
    readonly settlement: Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0]
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    if (!['working', 'waiting', 'revision_requested'].includes(input.contract.state)) {
      return undefined
    }
    yield* sql`
      UPDATE delegation_contracts SET state = ${'needs_attention'}, updated_at = ${input.now}
      WHERE id = ${input.contract.id}
    `
    const updateId = `orchestration:${input.contract.id}:${input.settlement.runId}:needs-attention`
    yield* insertOrchestrationUpdate(sql, {
      updateId,
      contract: input.contract,
      settlement: input.settlement,
      state: 'needs_attention',
      summary: `Worker Run ${input.settlement.runId} ${input.settlement.terminalStatus} and needs attention.`,
      now: input.now,
    })
    return {
      delegationUpdate: {
        delegationId: input.contract.id,
        parentSessionId: SessionId(input.contract.parent_session_id),
        state: 'needs_attention' as const,
      },
      orchestrationUpdate: {
        updateId,
        parentSessionId: SessionId(input.contract.parent_session_id),
        workerSessionId: input.settlement.sessionId,
        delegationId: input.contract.id,
        sourceRunId: input.settlement.runId,
        state: 'needs_attention' as const,
      },
    }
  })
}

function settleCompletedWorker(
  sql: SqlClient.SqlClient,
  input: {
    readonly contract: WorkerDelegationRow
    readonly settlement: Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0]
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    if (!input.settlement.finalResponse?.trim()) return undefined
    if (
      !['working', 'waiting', 'needs_attention', 'revision_requested'].includes(
        input.contract.state,
      )
    ) {
      return undefined
    }
    const revision = input.contract.latest_submission_revision + 1
    const summary = input.settlement.finalResponse.trim().slice(0, HOST_CAPTURED_RESULT_LIMIT)
    yield* sql`
      INSERT INTO delegation_submissions (
        delegation_id, revision, specification_revision, summary, submitted_by,
        source_run_id, provenance, created_at
      ) VALUES (
        ${input.contract.id}, ${revision}, ${input.contract.current_specification_revision},
        ${summary}, ${'session-host'}, ${input.settlement.runId}, ${'host-captured'}, ${input.now}
      )
    `
    yield* sql`
      INSERT INTO delegation_evidence (
        delegation_id, submission_revision, ordinal, kind, summary,
        reference, provenance_json, created_at
      ) VALUES (
        ${input.contract.id}, ${revision}, ${0}, ${'observed-command'},
        ${'The Session Host observed a normally completed Worker Run.'},
        ${input.settlement.runId},
        ${'{"source":"session-host","observation":"run-completed"}'}, ${input.now}
      )
    `
    yield* sql`
      UPDATE delegation_contracts SET state = ${'ready_for_review'}, updated_at = ${input.now}
      WHERE id = ${input.contract.id}
    `
    const updateId = `orchestration:${input.contract.id}:${input.settlement.runId}:ready-for-review`
    yield* insertOrchestrationUpdate(sql, {
      updateId,
      contract: input.contract,
      settlement: input.settlement,
      state: 'ready_for_review',
      summary,
      now: input.now,
    })
    return {
      delegationUpdate: {
        delegationId: input.contract.id,
        parentSessionId: SessionId(input.contract.parent_session_id),
        state: 'ready_for_review' as const,
        submissionRevision: revision,
      },
      orchestrationUpdate: {
        updateId,
        parentSessionId: SessionId(input.contract.parent_session_id),
        workerSessionId: input.settlement.sessionId,
        delegationId: input.contract.id,
        sourceRunId: input.settlement.runId,
        state: 'ready_for_review' as const,
      },
    }
  })
}

export function settleWorkerDelegation(
  sql: SqlClient.SqlClient,
  settlement: Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0],
  hasScheduledFollowUp: boolean,
  now: number,
) {
  return Effect.gen(function* () {
    const contract = yield* loadWorkerDelegation(sql, settlement.sessionId)
    if (!contract) return undefined
    if (settlement.terminalStatus !== 'completed') {
      return yield* settleUnsuccessfulWorker(sql, { contract, settlement, now })
    }
    if (hasScheduledFollowUp) return undefined
    return yield* settleCompletedWorker(sql, { contract, settlement, now })
  })
}
