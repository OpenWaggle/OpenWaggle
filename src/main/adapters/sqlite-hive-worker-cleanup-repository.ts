import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  type HiveWorkerCleanupCandidate,
  HiveWorkerCleanupRepository,
} from '../ports/hive-worker-cleanup-repository'

/** One cleanup pass inspects a bounded page; later triggers pick up the remainder. */
const HIVE_CLEANUP_CANDIDATE_LIMIT = 64
const AGENT_CALLER_PREFIX = 'session-agent:'

interface CandidateRow {
  readonly worker_session_id: string
  readonly parent_session_id: string
  readonly parent_caller_id: string
  readonly delegation_id: string
  readonly delegation_state: 'accepted' | 'cancelled'
  readonly delegation_updated_at: number
}

/**
 * A Worker is eligible only when every durable signal agrees that its work is finished and that
 * no user ever acted on it:
 * - its Delegation Contract is terminal and all Delegations it issued itself are terminal;
 * - it is unarchived, has no active Run, no Follow-up in any state, and no pending authorization;
 * - an agent caller spawned it, no non-agent caller ever journaled an operation against it
 *   (message, start, follow-up, steer, replace, interaction/authorization answer, rename,
 *   archive, unarchive, handoff, queue change, Waggle turn, ...), and it is not pinned;
 * - it has only its main branch: tree navigation and branch edits are not journaled, so any
 *   extra or archived branch is treated as user activity.
 * The operation journal is append-only, so the answer survives Host restarts.
 */
function loadCandidates(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: SessionId; readonly includeDirectWorkers: boolean },
) {
  const parentScope = input.includeDirectWorkers ? input.sessionId : null
  return sql<CandidateRow>`
    SELECT
      contracts.child_session_id AS worker_session_id,
      contracts.parent_session_id,
      spawns.caller_id AS parent_caller_id,
      contracts.id AS delegation_id,
      contracts.state AS delegation_state,
      contracts.updated_at AS delegation_updated_at
    FROM delegation_contracts AS contracts
    JOIN session_spawn_lineage AS lineage
      ON lineage.child_session_id = contracts.child_session_id
      AND lineage.parent_session_id = contracts.parent_session_id
    JOIN sessions AS workers ON workers.id = contracts.child_session_id
    JOIN session_operations AS spawns
      ON spawns.operation = ${'spawn'}
      AND spawns.target_scope = ${'parent:'} || contracts.parent_session_id
      AND spawns.status = ${'completed'}
      AND json_extract(spawns.outcome_json, '$.sessionId') = contracts.child_session_id
    WHERE (contracts.child_session_id = ${input.sessionId}
        OR contracts.parent_session_id = ${parentScope})
      AND contracts.state IN (${'accepted'}, ${'cancelled'})
      AND workers.archived = 0
      AND substr(spawns.caller_id, 1, ${AGENT_CALLER_PREFIX.length}) = ${AGENT_CALLER_PREFIX}
      AND NOT EXISTS (
        SELECT 1 FROM session_control_states AS control
        WHERE control.session_id = workers.id AND control.active_run_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM session_runs AS runs
        WHERE runs.session_id = workers.id
          AND runs.status IN (${'starting'}, ${'active'}, ${'stopping'})
      )
      AND NOT EXISTS (
        SELECT 1 FROM session_follow_ups AS follow_ups WHERE follow_ups.session_id = workers.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM session_authorization_requests AS requests
        WHERE requests.session_id = workers.id AND requests.status = ${'pending'}
      )
      AND NOT EXISTS (
        SELECT 1 FROM delegation_contracts AS issued
        WHERE issued.parent_session_id = workers.id
          AND issued.state NOT IN (${'accepted'}, ${'cancelled'})
      )
      AND NOT EXISTS (SELECT 1 FROM pinned_sessions AS pins WHERE pins.session_id = workers.id)
      AND NOT EXISTS (
        SELECT 1 FROM session_branches AS branches
        WHERE branches.session_id = workers.id
          AND (branches.is_main = 0 OR branches.archived_at IS NOT NULL)
      )
      AND NOT EXISTS (
        SELECT 1 FROM session_operations AS operations
        WHERE operations.target_scope = workers.id
          AND substr(operations.caller_id, 1, ${AGENT_CALLER_PREFIX.length})
            <> ${AGENT_CALLER_PREFIX}
      )
    ORDER BY contracts.child_session_id
    LIMIT ${HIVE_CLEANUP_CANDIDATE_LIMIT}
  `
}

function toCandidate(row: CandidateRow): HiveWorkerCleanupCandidate {
  return {
    workerSessionId: SessionId(row.worker_session_id),
    parentSessionId: SessionId(row.parent_session_id),
    parentCallerId: row.parent_caller_id,
    delegationId: row.delegation_id,
    delegationState: row.delegation_state,
    delegationUpdatedAt: row.delegation_updated_at,
  }
}

export const SqliteHiveWorkerCleanupRepositoryLive = Layer.effect(
  HiveWorkerCleanupRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return HiveWorkerCleanupRepository.of({
      findEligibleWorkers: (input) =>
        loadCandidates(sql, input).pipe(
          Effect.map((rows) => rows.map(toCandidate)),
          Effect.mapError(
            (cause) =>
              new SessionControlRepositoryError({ operation: 'find-hive-cleanup-workers', cause }),
          ),
        ),
    })
  }),
)
