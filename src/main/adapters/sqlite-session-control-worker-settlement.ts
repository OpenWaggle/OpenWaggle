import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { sessionAgentCallerId } from '../domain/session-control/root-session-project-reach'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'
import { markRunFailedAttention } from './sqlite-delegation-attention'
import { revisionFollowUpOwedSql } from './sqlite-delegation-revision-owed'
import { wakeMayReplaceResult } from './sqlite-delegation-wake-replacement'
import {
  insertOrchestrationUpdate,
  ORCHESTRATION_UPDATE_SUMMARY_LIMIT,
} from './sqlite-session-orchestration-update-insert'

interface WorkerDelegationRow {
  readonly id: string
  readonly parent_session_id: string
  readonly state: string
  readonly current_specification_revision: number
  readonly latest_submission_revision: number
  /** 1 when the Worker asked for help (`worker_request`) during the settling Run. */
  readonly explicit_needs_attention: number
  /** Who stopped the settling Run, when a Session Control mutation did. */
  readonly interrupted_by_caller_id: string | null
  /** 1 while a revision request newer than the settling Run is not queued yet. */
  readonly revision_follow_up_owed: number
}

const SETTLING_STATES = ['working', 'waiting', 'revision_requested']

/**
 * Whether a Run that completed with a reply settles this Delegation: a state it works in, or a
 * wake after its unreviewed result (`wakeMayReplaceResult`). A failed or empty wake leaves that
 * result reviewable.
 */
function settlesWithReply(
  sql: SqlClient.SqlClient,
  contract: WorkerDelegationRow,
  settlement: { readonly sessionId: string; readonly runId: string },
) {
  // The Run never saw the parent's feedback, so its reply is not the revision; the revision
  // request about to be queued starts the Run that is (`revisionFollowUpOwedSql`).
  if (contract.revision_follow_up_owed === 1) return Effect.succeed(false)
  if ([...SETTLING_STATES, 'needs_attention'].includes(contract.state)) return Effect.succeed(true)
  if (contract.state !== 'ready_for_review') return Effect.succeed(false)
  return wakeMayReplaceResult(sql, {
    delegationId: contract.id,
    workerSessionId: settlement.sessionId,
    runId: settlement.runId,
    whileActive: false,
  })
}

function loadWorkerDelegation(sql: SqlClient.SqlClient, sessionId: SessionId, runId: string) {
  return sql<WorkerDelegationRow>`
    SELECT contracts.id, contracts.parent_session_id, contracts.state,
      contracts.current_specification_revision,
      COALESCE(MAX(submissions.revision), 0) AS latest_submission_revision,
      (contracts.state = ${'needs_attention'}
        AND contracts.attention_cause = ${'worker_request'}
        AND EXISTS (
          SELECT 1 FROM delegation_state_transitions AS transitions
          WHERE transitions.id = (
              SELECT MAX(latest.id) FROM delegation_state_transitions AS latest
              WHERE latest.delegation_id = contracts.id
            )
            AND transitions.to_state = ${'needs_attention'}
            -- Set during the settling Run: an earlier request the parent left unanswered settles
            -- as usual once a later Run completes with text. A Hive wake is not the parent
            -- answering either (its own Workers reported), so its reply never clears the request.
            AND (
              transitions.created_at >= COALESCE(
                (SELECT runs.created_at FROM session_runs AS runs WHERE runs.id = ${runId}), 0
              )
              OR EXISTS (
                SELECT 1 FROM session_runs AS runs
                WHERE runs.id = ${runId} AND json_extract(runs.intent_json, '$.hiveWake') = 1
              )
            )
      )) AS explicit_needs_attention,
      (SELECT runs.interrupted_by_caller_id FROM session_runs AS runs WHERE runs.id = ${runId})
        AS interrupted_by_caller_id,
      ${revisionFollowUpOwedSql(sql, runId)} AS revision_follow_up_owed
    FROM delegation_contracts AS contracts
    LEFT JOIN delegation_submissions AS submissions ON submissions.delegation_id = contracts.id
    WHERE contracts.child_session_id = ${sessionId}
    GROUP BY contracts.id
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function insertSettlementUpdate(
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
  return insertOrchestrationUpdate(sql, {
    updateId: input.updateId,
    parentSessionId: input.contract.parent_session_id,
    workerSessionId: input.settlement.sessionId,
    delegationId: input.contract.id,
    sourceRunId: input.settlement.runId,
    state: input.state,
    summary: input.summary,
    now: input.now,
    // Whoever stopped a Run that did not complete caused its end; otherwise its own agent, so
    // whoever started it. Only a completed Run proves a late stop changed nothing.
    triggerCallerId:
      (input.settlement.terminalStatus === 'completed'
        ? null
        : input.contract.interrupted_by_caller_id) ??
      sessionAgentCallerId(input.settlement.sessionId, input.settlement.runId),
  })
}

function settleUnsuccessfulWorker(
  sql: SqlClient.SqlClient,
  input: {
    readonly contract: WorkerDelegationRow
    readonly settlement: Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0]
    readonly summary?: string
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    if (!SETTLING_STATES.includes(input.contract.state)) return undefined
    const summary =
      input.summary ??
      `Worker Run ${input.settlement.runId} ${input.settlement.terminalStatus} and needs attention.`
    yield* markRunFailedAttention(sql, {
      delegationId: input.contract.id,
      workerSessionId: input.settlement.sessionId,
      fromState: input.contract.state,
      summary,
      now: input.now,
    })
    const updateId = `orchestration:${input.contract.id}:${input.settlement.runId}:needs-attention`
    yield* insertSettlementUpdate(sql, {
      updateId,
      contract: input.contract,
      settlement: input.settlement,
      state: 'needs_attention',
      summary,
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
    if (!(yield* settlesWithReply(sql, input.contract, input.settlement))) return undefined
    // A Worker that asked for attention in this Run, or in any Run before a Hive wake, stays
    // there: its reply explains the request and is not a result. A Host-set needs_attention, or
    // one from an earlier Run the parent has since answered, is resolved here.
    if (input.contract.explicit_needs_attention === 1) return undefined
    const revision = input.contract.latest_submission_revision + 1
    const summary = input.settlement.finalResponse
      .trim()
      .slice(0, ORCHESTRATION_UPDATE_SUMMARY_LIMIT)
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
      UPDATE delegation_contracts
      SET state = ${'ready_for_review'}, attention_cause = NULL, updated_at = ${input.now}
      WHERE id = ${input.contract.id}
    `
    const updateId = `orchestration:${input.contract.id}:${input.settlement.runId}:ready-for-review`
    yield* insertSettlementUpdate(sql, {
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
    const contract = yield* loadWorkerDelegation(sql, settlement.sessionId, settlement.runId)
    if (!contract) return undefined
    if (settlement.terminalStatus !== 'completed') {
      return yield* settleUnsuccessfulWorker(sql, { contract, settlement, now })
    }
    if (hasScheduledFollowUp) return undefined
    if (!settlement.finalResponse?.trim()) {
      return yield* settleUnsuccessfulWorker(sql, {
        contract,
        settlement,
        summary: `Worker Run ${settlement.runId} completed without a textual final response.`,
        now,
      })
    }
    return yield* settleCompletedWorker(sql, { contract, settlement, now })
  })
}
