import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  HIVE_AGENT_CALLER_PREFIX,
  HIVE_CLEANUP_IDEMPOTENCY_PREFIX,
  type HiveWorkerArchiveResult,
  type HiveWorkerCleanupCandidate,
  HiveWorkerCleanupRepository,
  type HiveWorkerCleanupRepositoryShape,
  isHiveAgentCaller,
} from '../ports/hive-worker-cleanup-repository'
import { liveSessionAuthorityBlockReason } from './sqlite-session-live-authority'
import { executeOrganization } from './sqlite-session-organization-repository'

/** One cleanup pass inspects a bounded page; later triggers pick up the remainder. */
const HIVE_CLEANUP_CANDIDATE_LIMIT = 64
const AGENT_CALLER_PREFIX = HIVE_AGENT_CALLER_PREFIX
/**
 * Delegation mutations are journaled under `delegation:<id>:actor:<session>`. `;` is the code
 * point after `:`, so `[delegation:<id>:, delegation:<id>;)` is exactly that id's scopes, as an
 * index range on `idx_session_operations_pending_target` that no LIKE wildcard can widen.
 */
const DELEGATION_SCOPE_PREFIX = 'delegation:'
const DELEGATION_SCOPE_SEPARATOR = ':'
const DELEGATION_SCOPE_UPPER_BOUND = ';'

interface CandidateRow {
  readonly worker_session_id: string
  readonly parent_session_id: string
  readonly parent_caller_id: string
  readonly delegation_id: string
  readonly delegation_state: 'accepted' | 'cancelled'
  readonly delegation_updated_at: number
}

interface ArchiveStateRow {
  readonly archived: number
  readonly caller_id: string | null
  readonly operation: string | null
  readonly idempotency_key: string | null
}

/**
 * A Worker is eligible only when every durable signal agrees that its work is finished and that
 * no user ever acted on it:
 * - its Delegation Contract is terminal and all Delegations it issued itself are terminal;
 * - it is unarchived, has no active Run, no Follow-up in any state, and no pending authorization;
 * - an agent caller spawned it, no non-agent caller ever journaled an operation against it
 *   (message, start, follow-up, steer, replace, interaction/authorization answer, rename,
 *   archive, unarchive, handoff, queue change, Waggle turn, ...) or against its Delegation
 *   (accept, cancel, revision request, reopen, submit, ...), and it is not pinned;
 * - it has only its main branch: tree navigation and branch edits are not journaled, so any
 *   extra or archived branch is treated as user activity.
 * The operation journal is append-only, so the answer survives Host restarts.
 */
export function hiveWorkerCleanupCandidateStatement(
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
        SELECT 1 FROM session_runs AS request_runs
        JOIN session_authorization_requests AS requests
          ON requests.run_id = request_runs.id AND requests.status = ${'pending'}
        WHERE request_runs.session_id = workers.id AND requests.session_id = workers.id
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
      AND NOT EXISTS (
        SELECT 1 FROM session_operations AS reviews
        WHERE reviews.target_scope
            >= ${DELEGATION_SCOPE_PREFIX} || contracts.id || ${DELEGATION_SCOPE_SEPARATOR}
          AND reviews.target_scope
            < ${DELEGATION_SCOPE_PREFIX} || contracts.id || ${DELEGATION_SCOPE_UPPER_BOUND}
          AND substr(reviews.caller_id, 1, ${AGENT_CALLER_PREFIX.length}) <> ${AGENT_CALLER_PREFIX}
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

function repositoryError(operation: string) {
  return (cause: unknown) =>
    cause instanceof SessionControlRepositoryError
      ? cause
      : new SessionControlRepositoryError({ operation, cause })
}

function archiveIfStillEligible(
  sql: SqlClient.SqlClient,
  input: Parameters<HiveWorkerCleanupRepositoryShape['archiveIfStillEligible']>[0],
) {
  const { candidate } = input
  return sql
    .withTransaction(
      Effect.gen(function* () {
        // The Host's SQLite client runs one transaction at a time, so a pin, branch edit, or
        // user operation either committed before this read or waits until after the archive.
        const rows = yield* hiveWorkerCleanupCandidateStatement(sql, {
          sessionId: candidate.workerSessionId,
          includeDirectWorkers: false,
        })
        const current = rows.find(
          (row) =>
            row.worker_session_id === candidate.workerSessionId &&
            row.delegation_id === candidate.delegationId &&
            row.delegation_updated_at === candidate.delegationUpdatedAt &&
            row.parent_caller_id === candidate.parentCallerId,
        )
        if (!current) return { status: 'kept', reason: 'ineligible' } as const
        if (yield* liveSessionAuthorityBlockReason(sql, candidate.parentCallerId)) {
          return { status: 'kept', reason: 'parent-authority-revoked' } as const
        }
        const response = yield* executeOrganization(sql, {
          callerId: candidate.parentCallerId,
          request: {
            ...input.envelope,
            command: { operation: 'archive', sessionId: candidate.workerSessionId },
          },
        })
        return { status: 'archived', response } as const
      }),
    )
    .pipe(
      Effect.map((result): HiveWorkerArchiveResult => result),
      Effect.mapError(repositoryError('archive-hive-cleanup-worker')),
    )
}

function restoreCleanupArchive(
  sql: SqlClient.SqlClient,
  input: Parameters<HiveWorkerCleanupRepositoryShape['restoreCleanupArchive']>[0],
) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<ArchiveStateRow>`
          SELECT sessions.archived, latest.caller_id, latest.operation, latest.idempotency_key
          FROM sessions
          LEFT JOIN session_operations AS latest ON latest.id = (
            SELECT operations.id FROM session_operations AS operations
            WHERE operations.target_scope = sessions.id
              AND operations.operation IN (${'archive'}, ${'unarchive'})
              AND operations.status = ${'completed'}
              AND json_extract(operations.outcome_json, '$.effect')
                IN (${'session-archived'}, ${'session-unarchived'})
            ORDER BY operations.id DESC
            LIMIT 1
          )
          WHERE sessions.id = ${input.sessionId}
          LIMIT 1
        `
        const state = rows[0]
        const archivedByCleanup =
          state?.archived === 1 &&
          state.operation === 'archive' &&
          state.caller_id !== null &&
          isHiveAgentCaller(state.caller_id) &&
          state.idempotency_key?.startsWith(HIVE_CLEANUP_IDEMPOTENCY_PREFIX) === true
        if (!archivedByCleanup) return undefined
        return yield* executeOrganization(sql, {
          callerId: input.callerId,
          request: {
            ...input.envelope,
            command: { operation: 'unarchive', sessionId: input.sessionId },
          },
        })
      }),
    )
    .pipe(Effect.mapError(repositoryError('restore-hive-cleanup-worker')))
}

export const SqliteHiveWorkerCleanupRepositoryLive = Layer.effect(
  HiveWorkerCleanupRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return HiveWorkerCleanupRepository.of({
      findEligibleWorkers: (input) =>
        hiveWorkerCleanupCandidateStatement(sql, input).pipe(
          Effect.map((rows) => rows.map(toCandidate)),
          Effect.mapError(repositoryError('find-hive-cleanup-workers')),
        ),
      archiveIfStillEligible: (input) => archiveIfStillEligible(sql, input),
      restoreCleanupArchive: (input) => restoreCleanupArchive(sql, input),
    })
  }),
)
