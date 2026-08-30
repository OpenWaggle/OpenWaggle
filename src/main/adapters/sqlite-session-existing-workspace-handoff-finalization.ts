import type * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import type { SessionOrganizationRepositoryShape } from '../ports/session-organization-repository'

type CompleteInput = Parameters<SessionOrganizationRepositoryShape['completeExistingHandoff']>[0]
type AbortInput = Parameters<SessionOrganizationRepositoryShape['abortExistingHandoff']>[0]

interface OperationRow {
  readonly request_json: string
  readonly status: 'pending' | 'completed'
}

interface SessionRow {
  readonly workspace_id: string | null
  readonly active_run_id: string | null
}

interface WorkspaceRow {
  readonly id: string
  readonly kind: 'local' | 'managed-worktree'
  readonly working_path: string
  readonly lifecycle_state: string
  readonly worktree_base_ref: string | null
  readonly worktree_start_from_origin: number
  readonly handoff_seed_ref: string | null
  readonly handoff_seed_base_ref: string | null
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function response(input: CompleteInput | AbortInput, outcome: SessionControlMutationOutcome) {
  return {
    contractVersion: input.request.contractVersion,
    requestId: input.request.requestId,
    idempotencyKey: input.request.idempotencyKey,
    replayed: false,
    outcome,
  }
}

function loadOperation(sql: SqlClient.SqlClient, input: CompleteInput | AbortInput) {
  return sql<OperationRow>`
    SELECT request_json, status FROM session_operations
    WHERE caller_id = ${input.callerId} AND operation = ${'handoff'}
      AND target_scope = ${input.request.command.sessionId}
      AND idempotency_key = ${input.request.idempotencyKey}
    LIMIT 1
  `
}

function loadSession(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<SessionRow>`
    SELECT session_workspace_bindings.workspace_id, session_control_states.active_run_id
    FROM sessions
    LEFT JOIN session_workspace_bindings
      ON session_workspace_bindings.session_id = sessions.id
    LEFT JOIN session_control_states ON session_control_states.session_id = sessions.id
    WHERE sessions.id = ${sessionId} LIMIT 1
  `
}

function loadWorkspace(sql: SqlClient.SqlClient, workspaceId: string) {
  return sql<WorkspaceRow>`
    SELECT id, kind, working_path, lifecycle_state, worktree_base_ref,
      worktree_start_from_origin, handoff_seed_ref, handoff_seed_base_ref
    FROM workspace_resources WHERE id = ${workspaceId} LIMIT 1
  `
}

function assertPendingOperation(
  input: CompleteInput | AbortInput,
  operation: OperationRow | undefined,
  stage: string,
) {
  if (
    operation?.request_json !== canonicalJson(input.request.command) ||
    operation.status !== 'pending'
  ) {
    throw repositoryError(stage, input.request.command)
  }
}

function completionStateMatches(
  input: CompleteInput,
  session: SessionRow | undefined,
  target: WorkspaceRow | undefined,
) {
  return (
    session !== undefined &&
    !session.active_run_id &&
    session.workspace_id === input.handoff.previousWorkspaceId &&
    target !== undefined &&
    target.lifecycle_state === 'materializing' &&
    target.handoff_seed_ref === input.preparedHandoff.snapshotRef &&
    target.handoff_seed_base_ref === input.preparedHandoff.sourceHead
  )
}

export function completeExistingHandoff(sql: SqlClient.SqlClient, input: CompleteInput) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const operation = (yield* loadOperation(sql, input))[0]
        yield* Effect.try({
          try: () =>
            assertPendingOperation(input, operation, 'complete-existing-handoff-operation'),
          catch: (cause) =>
            cause instanceof SessionControlRepositoryError
              ? cause
              : repositoryError('complete-existing-handoff-operation', cause),
        })
        const session = (yield* loadSession(sql, input.request.command.sessionId))[0]
        const target = (yield* loadWorkspace(sql, input.handoff.workspaceId))[0]
        if (!completionStateMatches(input, session, target) || !target) {
          return yield* Effect.fail(
            repositoryError('complete-existing-workspace-handoff-state', input.request.command),
          )
        }
        const now = Date.now()
        yield* sql`
          UPDATE session_workspace_bindings SET workspace_id = ${target.id}, bound_at = ${now}
          WHERE session_id = ${input.request.command.sessionId}
            AND workspace_id = ${input.handoff.previousWorkspaceId}
        `
        yield* sql`
          UPDATE sessions
          SET environment_mode = ${target.kind === 'managed-worktree' ? 'worktree' : 'local'},
              worktree_path = ${target.kind === 'managed-worktree' ? target.working_path : null},
              worktree_base_ref = ${target.worktree_base_ref},
              worktree_start_from_origin = ${target.worktree_start_from_origin}, updated_at = ${now}
          WHERE id = ${input.request.command.sessionId}
        `
        yield* sql`
          UPDATE workspace_resources
          SET lifecycle_state = ${'ready'}, handoff_seed_ref = ${null},
              handoff_seed_base_ref = ${null}, handoff_seed_state = ${'none'}, updated_at = ${now}
          WHERE id = ${target.id} AND lifecycle_state = ${'materializing'}
        `
        yield* sql`
          DELETE FROM workspace_resources
          WHERE id = ${input.handoff.previousWorkspaceId} AND lifecycle_state = ${'pending'}
            AND NOT EXISTS (
              SELECT 1 FROM session_workspace_bindings
              WHERE workspace_id = ${input.handoff.previousWorkspaceId}
            )
        `
        const outcome = {
          operation: 'handoff',
          effect: 'session-handed-off',
          sessionId: input.request.command.sessionId,
          previousWorkspaceId: input.handoff.previousWorkspaceId,
          workspaceId: target.id,
          workspaceState: 'ready',
        } satisfies SessionControlMutationOutcome
        yield* sql`
          UPDATE session_operations
          SET status = ${'completed'}, outcome_json = ${JSON.stringify(outcome)},
              cleanup_json = ${JSON.stringify({
                kind: 'workspace-handoff-refs',
                projectPath: input.preparedHandoff.projectPath,
                snapshotRef: input.preparedHandoff.snapshotRef,
                targetSnapshotRef: input.preparedHandoff.targetSnapshotRef,
              })}, updated_at = ${now}
          WHERE caller_id = ${input.callerId} AND operation = ${'handoff'}
            AND target_scope = ${input.request.command.sessionId}
            AND idempotency_key = ${input.request.idempotencyKey} AND status = ${'pending'}
        `
        return response(input, outcome)
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('complete-existing-workspace-handoff', cause),
      ),
    )
}

export function abortExistingHandoff(sql: SqlClient.SqlClient, input: AbortInput) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const operation = (yield* loadOperation(sql, input))[0]
        yield* Effect.try({
          try: () => assertPendingOperation(input, operation, 'abort-existing-handoff-operation'),
          catch: (cause) =>
            cause instanceof SessionControlRepositoryError
              ? cause
              : repositoryError('abort-existing-handoff-operation', cause),
        })
        const now = Date.now()
        yield* sql`
          UPDATE workspace_resources
          SET lifecycle_state = ${input.targetRestored ? 'ready' : 'failed'},
              handoff_seed_ref = ${input.targetRestored ? null : input.preparedHandoff.snapshotRef},
              handoff_seed_base_ref = ${
                input.targetRestored ? null : input.preparedHandoff.sourceHead
              },
              handoff_seed_state = ${input.targetRestored ? 'none' : 'failed'}, updated_at = ${now}
          WHERE id = ${input.handoff.workspaceId} AND lifecycle_state = ${'materializing'}
        `
        const outcome = {
          operation: 'handoff',
          effect: 'rejected',
          sessionId: input.request.command.sessionId,
          code: 'workspace_target_transfer_failed',
        } satisfies SessionControlMutationOutcome
        yield* sql`
          UPDATE session_operations
          SET status = ${'completed'}, outcome_json = ${JSON.stringify(outcome)}, updated_at = ${now}
          WHERE caller_id = ${input.callerId} AND operation = ${'handoff'}
            AND target_scope = ${input.request.command.sessionId}
            AND idempotency_key = ${input.request.idempotencyKey} AND status = ${'pending'}
        `
        return response(input, outcome)
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('abort-existing-workspace-handoff', cause),
      ),
    )
}
