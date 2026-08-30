import type * as SqlClient from '@effect/sql/SqlClient'
import {
  SESSION_LIFECYCLE_CONTRACT_VERSION,
  type SessionLifecycleOutcome,
} from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { SessionLifecycleRepositoryError } from '../errors'
import type {
  SessionLifecycleRepositoryShape,
  SessionLifecycleWorkspacePlan,
} from '../ports/session-lifecycle-repository'

type ExecuteInput = Parameters<SessionLifecycleRepositoryShape['execute']>[0]

export interface LifecycleWorkspaceRow {
  readonly id: string
  readonly project_path: string
  readonly kind: 'local' | 'managed-worktree'
  readonly working_path: string
  readonly lifecycle_state: string
  readonly worktree_base_ref: string | null
  readonly worktree_start_from_origin: number
}

function lifecycleSupportError(operation: string, cause: unknown) {
  return new SessionLifecycleRepositoryError({ operation, cause })
}

export function resolveLifecycleWorkspace(
  sql: SqlClient.SqlClient,
  plan: SessionLifecycleWorkspacePlan,
  parentSessionId: string | undefined,
  now: number,
) {
  return Effect.gen(function* () {
    if (plan.mode === 'parent') {
      if (!parentSessionId) {
        return yield* Effect.fail(
          lifecycleSupportError('parent-session-required-for-workspace', { plan }),
        )
      }
      const rows = yield* sql<LifecycleWorkspaceRow>`
        SELECT
          workspace_resources.id,
          workspace_resources.project_path,
          workspace_resources.kind,
          workspace_resources.working_path,
          workspace_resources.lifecycle_state,
          workspace_resources.worktree_base_ref,
          workspace_resources.worktree_start_from_origin
        FROM session_workspace_bindings
        JOIN workspace_resources
          ON workspace_resources.id = session_workspace_bindings.workspace_id
        WHERE session_workspace_bindings.session_id = ${parentSessionId}
        LIMIT 1
      `
      if (!rows[0]) {
        return yield* Effect.fail(
          lifecycleSupportError('parent-workspace-binding-not-found', { parentSessionId }),
        )
      }
      return rows[0]
    }
    if (plan.mode === 'existing') {
      const rows = yield* sql<LifecycleWorkspaceRow>`
        SELECT
          id, project_path, kind, working_path, lifecycle_state,
          worktree_base_ref, worktree_start_from_origin
        FROM workspace_resources
        WHERE id = ${plan.workspaceId}
        LIMIT 1
      `
      if (!rows[0]) {
        return yield* Effect.fail(
          lifecycleSupportError('workspace-not-found', { workspaceId: plan.workspaceId }),
        )
      }
      return rows[0]
    }
    const workspace = plan.workspace
    yield* sql`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state, worktree_branch,
        worktree_base_ref, worktree_start_from_origin, created_at, updated_at
      ) VALUES (
        ${workspace.id}, ${workspace.projectPath}, ${workspace.kind}, ${workspace.workingPath},
        ${workspace.lifecycleState}, ${workspace.worktreeBranch ?? null},
        ${workspace.worktreeBaseRef ?? null}, ${workspace.worktreeStartFromOrigin ? 1 : 0},
        ${now}, ${now}
      )
    `
    return {
      id: workspace.id,
      project_path: workspace.projectPath,
      kind: workspace.kind,
      working_path: workspace.workingPath,
      lifecycle_state: workspace.lifecycleState,
      worktree_base_ref: workspace.worktreeBaseRef ?? null,
      worktree_start_from_origin: workspace.worktreeStartFromOrigin ? 1 : 0,
    } satisfies LifecycleWorkspaceRow
  })
}

export function lifecycleResponse(
  input: Pick<ExecuteInput, 'request'>,
  replayed: boolean,
  outcome: SessionLifecycleOutcome,
) {
  return {
    contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
    requestId: input.request.requestId,
    idempotencyKey: input.request.idempotencyKey,
    replayed,
    outcome,
  }
}

export function storeLifecycleOutcome(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  scope: string,
  requestJson: string,
  outcome: SessionLifecycleOutcome,
) {
  return sql`
    INSERT INTO session_operations (
      caller_id, operation, target_scope, idempotency_key, request_json,
      status, outcome_json, created_at, updated_at
    ) VALUES (
      ${input.callerId}, ${input.request.command.operation}, ${scope},
      ${input.request.idempotencyKey}, ${requestJson}, ${'completed'},
      ${JSON.stringify(outcome)}, ${input.now}, ${input.now}
    )
  `
}
