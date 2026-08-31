import { matchBy } from '@diegogbrisa/ts-match'
import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionLifecycleOutcome } from '@shared/schemas/session-lifecycle'
import { RunId, SessionId } from '@shared/types/brand'
import type { SessionLifecycleOutcome } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { decideSpawnAdmission } from '../domain/session-control/spawn-admission'
import { planChildLineage } from '../domain/session-control/spawn-lineage'
import { SessionLifecycleRepositoryError } from '../errors'
import type { SessionLifecycleRepositoryShape } from '../ports/session-lifecycle-repository'
import { loadSessionControlState } from './sqlite-session-control-state'
import { lifecycleResponse, storeLifecycleOutcome } from './sqlite-session-lifecycle-support'

const DEFAULT_PARENT_CONCURRENCY_LIMIT = 4
const DEFAULT_HOST_RUN_CEILING = 16

type ExecuteInput = Parameters<SessionLifecycleRepositoryShape['execute']>[0]
type ReplayInput = Pick<ExecuteInput, 'callerId' | 'request'>

interface OperationRow {
  readonly request_json: string
  readonly outcome_json: string | null
  readonly status: 'pending' | 'completed'
}

interface ParentSessionRow {
  readonly project_path: string
}

interface ParentLineageRow {
  readonly hive_root_session_id: string
  readonly depth: number
}

export interface LifecycleTarget {
  readonly projectPath: string
  readonly parentSessionId?: string
  readonly parentRunId?: string
  readonly hiveRootSessionId?: string
  readonly depth?: number
}

export type LifecycleTargetResolution =
  | { readonly kind: 'accepted'; readonly target: LifecycleTarget }
  | { readonly kind: 'rejected'; readonly response: ReturnType<typeof lifecycleResponse> }

function repositoryError(operation: string, cause: unknown) {
  return new SessionLifecycleRepositoryError({ operation, cause })
}

export function findLifecycleReplay(
  sql: SqlClient.SqlClient,
  input: ReplayInput,
  scope: string,
  requestJson: string,
) {
  const operation = input.request.command.operation
  return Effect.gen(function* () {
    const rows = yield* sql<OperationRow>`
      SELECT request_json, outcome_json, status
      FROM session_operations
      WHERE caller_id = ${input.callerId}
        AND operation = ${operation}
        AND target_scope = ${scope}
        AND idempotency_key = ${input.request.idempotencyKey}
      LIMIT 1
    `
    const existing = rows[0]
    if (!existing) return undefined
    if (existing.request_json !== requestJson) {
      return yield* Effect.fail(
        repositoryError('idempotency-key-reused', {
          operation,
          scope,
          idempotencyKey: input.request.idempotencyKey,
        }),
      )
    }
    if (existing.status !== 'completed' || existing.outcome_json === null) {
      return yield* Effect.fail(repositoryError('operation-pending', { operation, scope }))
    }
    const outcomeJson = existing.outcome_json
    const outcome = yield* Effect.try({
      try: () => decodeSessionLifecycleOutcome(parseJsonUnknown(outcomeJson)),
      catch: (cause) => repositoryError('decode-idempotent-outcome', cause),
    })
    return lifecycleResponse(input, true, outcome)
  })
}

function forkTarget(
  sql: SqlClient.SqlClient,
  command: Extract<ExecuteInput['request']['command'], { readonly operation: 'fork' }>,
) {
  return Effect.gen(function* () {
    const sourceRows = yield* sql<ParentSessionRow>`
      SELECT project_path FROM sessions WHERE id = ${command.sourceSessionId} LIMIT 1
    `
    const source = sourceRows[0]
    if (!source) {
      return yield* Effect.fail(
        repositoryError('fork-source-session-not-found', {
          sourceSessionId: command.sourceSessionId,
        }),
      )
    }
    return {
      kind: 'accepted',
      target: { projectPath: source.project_path, parentSessionId: command.sourceSessionId },
    } satisfies LifecycleTargetResolution
  })
}

function launchTarget(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  scope: string,
  requestJson: string,
  command: Extract<ExecuteInput['request']['command'], { readonly operation: 'launch' }>,
) {
  return Effect.gen(function* () {
    const hostRunRows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_control_states
      WHERE active_run_id IS NOT NULL
    `
    const hostActiveRuns = hostRunRows[0]?.count ?? 0
    const hostRunCeiling = input.hostRunCeiling ?? DEFAULT_HOST_RUN_CEILING
    if (hostActiveRuns >= hostRunCeiling) {
      const outcome: SessionLifecycleOutcome = {
        operation: 'launch',
        effect: 'rejected',
        code: 'host_run_ceiling_reached',
        retryable: true,
        hostRunCeiling,
        hostActiveRuns,
      }
      yield* storeLifecycleOutcome(sql, input, scope, requestJson, outcome)
      return {
        kind: 'rejected',
        response: lifecycleResponse(input, false, outcome),
      } satisfies LifecycleTargetResolution
    }
    return {
      kind: 'accepted',
      target: { projectPath: command.projectPath },
    } satisfies LifecycleTargetResolution
  })
}

function spawnTarget(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  scope: string,
  requestJson: string,
  command: Extract<ExecuteInput['request']['command'], { readonly operation: 'spawn' }>,
) {
  const parentSessionId = command.parentSessionId
  const parentRunId = command.expectedParentRunId
  return Effect.gen(function* () {
    const parentRows = yield* sql<ParentSessionRow>`
      SELECT project_path FROM sessions WHERE id = ${parentSessionId} LIMIT 1
    `
    const parent = parentRows[0]
    if (!parent) {
      return yield* Effect.fail(repositoryError('parent-session-not-found', { parentSessionId }))
    }
    const parentState = yield* loadSessionControlState(sql, parentSessionId)
    const runningChildRows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_spawn_lineage
      JOIN session_control_states
        ON session_control_states.session_id = session_spawn_lineage.child_session_id
      WHERE session_spawn_lineage.parent_session_id = ${parentSessionId}
        AND session_control_states.active_run_id IS NOT NULL
    `
    const hostRunRows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM session_control_states WHERE active_run_id IS NOT NULL
    `
    const admission = decideSpawnAdmission({
      parentSessionId: SessionId(parentSessionId),
      expectedParentRunId: RunId(parentRunId),
      parentRun:
        parentState.run.state === 'idle'
          ? { state: 'idle' }
          : { state: parentState.run.state, runId: parentState.run.runId },
      parentRunningChildren: runningChildRows[0]?.count ?? 0,
      parentConcurrencyLimit: input.parentConcurrencyLimit ?? DEFAULT_PARENT_CONCURRENCY_LIMIT,
      hostActiveRuns: hostRunRows[0]?.count ?? 0,
      hostRunCeiling: input.hostRunCeiling ?? DEFAULT_HOST_RUN_CEILING,
    })
    if (!admission.accepted) {
      const outcome: SessionLifecycleOutcome = {
        operation: 'spawn',
        effect: 'rejected',
        code: admission.code,
        retryable: admission.retryable,
        parentConcurrencyLimit: admission.parentConcurrencyLimit,
        parentRunningChildren: admission.parentRunningChildren,
        hostRunCeiling: admission.hostRunCeiling,
        hostActiveRuns: admission.hostActiveRuns,
      }
      yield* storeLifecycleOutcome(sql, input, scope, requestJson, outcome)
      return {
        kind: 'rejected',
        response: lifecycleResponse(input, false, outcome),
      } satisfies LifecycleTargetResolution
    }
    const lineageRows = yield* sql<ParentLineageRow>`
      SELECT hive_root_session_id, depth
      FROM session_spawn_lineage
      WHERE child_session_id = ${parentSessionId}
      LIMIT 1
    `
    const lineage = planChildLineage({
      parentSessionId: SessionId(parentSessionId),
      ...(lineageRows[0]
        ? {
            hiveRootSessionId: SessionId(lineageRows[0].hive_root_session_id),
            depth: lineageRows[0].depth,
          }
        : {}),
    })
    return {
      kind: 'accepted',
      target: {
        projectPath: parent.project_path,
        parentSessionId,
        parentRunId,
        hiveRootSessionId: lineage.hiveRootSessionId,
        depth: lineage.depth,
      },
    } satisfies LifecycleTargetResolution
  })
}

function admittedSpawnTarget(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  scope: string,
  requestJson: string,
) {
  return matchBy(input.request.command, 'operation')
    .with('fork', (command) => forkTarget(sql, command))
    .with('launch', (command) => launchTarget(sql, input, scope, requestJson, command))
    .with('spawn', (command) => spawnTarget(sql, input, scope, requestJson, command))
    .with('create', (command) =>
      Effect.succeed<LifecycleTargetResolution>({
        kind: 'accepted',
        target: { projectPath: command.projectPath },
      }),
    )
    .exhaustive()
}

export function resolveLifecycleTarget(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  scope: string,
  requestJson: string,
) {
  return admittedSpawnTarget(sql, input, scope, requestJson)
}
