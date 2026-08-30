import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionLifecycleRepositoryError } from '../errors'
import type { SessionLifecycleRepositoryShape } from '../ports/session-lifecycle-repository'
import { encodeSessionAuthoritySnapshot } from '../session-host/session-authority-snapshot'
import { mainBranchId } from '../store/session-details/branch-utils'
import {
  DEFAULT_BRANCH_UI_STATE_JSON,
  EXPANDED_NODE_IDS_DEFAULT_JSON,
  EXPANDED_NODE_IDS_UNTOUCHED,
  MAIN_BRANCH_NAME,
  STANDARD_FUTURE_MODE,
  TREE_SIDEBAR_EXPANDED,
} from '../store/session-details/constants'
import { persistSessionSnapshotWithSql } from '../store/session-details/persist-snapshot'
import type { LifecycleWorkspaceRow } from './sqlite-session-lifecycle-support'

type ExecuteInput = Parameters<SessionLifecycleRepositoryShape['execute']>[0]

function repositoryError(operation: string, cause: unknown) {
  return new SessionLifecycleRepositoryError({ operation, cause })
}

function initialRunIntent(input: ExecuteInput) {
  const command = input.request.command
  if (command.operation === 'create' || command.operation === 'fork') return undefined
  const text = command.operation === 'launch' ? command.objective : command.delegation.objective
  const attachmentIds = command.attachmentIds ?? []
  return {
    text,
    attachmentIds,
    ...(command.interactionTimeoutMs !== undefined
      ? { interactionTimeoutMs: command.interactionTimeoutMs }
      : {}),
    ...(command.runAuthorizationOverride
      ? { runAuthorizationOverride: command.runAuthorizationOverride }
      : {}),
    callerId: input.callerId,
    acceptedAt: input.now,
    idempotencyKey: input.request.idempotencyKey,
  }
}

function persistSessionMetadata(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  projectPath: string,
  workspace: LifecycleWorkspaceRow,
  authorityOriginCallerId: string,
  authorityScope: ExecuteInput['callerAuthorityScope'],
) {
  const command = input.request.command
  const title =
    command.operation === 'spawn' ? command.delegation.objective : (command.title ?? 'New session')
  const environmentMode = workspace.kind === 'managed-worktree' ? 'worktree' : 'local'
  const worktreePath =
    workspace.kind === 'managed-worktree' && workspace.lifecycle_state === 'ready'
      ? workspace.working_path
      : null
  const branchId = mainBranchId(String(input.session.sessionId))
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (
        id, pi_session_id, pi_session_file, project_path, title, archived,
        created_at, updated_at, last_active_branch_id, environment_mode, worktree_path,
        worktree_base_ref, worktree_start_from_origin, authorization_mode_override
      ) VALUES (
        ${input.session.sessionId}, ${input.session.piSessionId},
        ${input.session.piSessionFile ?? null}, ${projectPath}, ${title}, ${0},
        ${input.now}, ${input.now}, ${branchId}, ${environmentMode}, ${worktreePath},
        ${workspace.worktree_base_ref}, ${workspace.worktree_start_from_origin},
        ${null}
      )
    `
    yield* sql`
      INSERT INTO session_branches (
        id, session_id, source_node_id, head_node_id, name, is_main,
        archived_at, created_at, updated_at
      ) VALUES (
        ${branchId}, ${input.session.sessionId}, ${null}, ${null}, ${MAIN_BRANCH_NAME}, ${1},
        ${null}, ${input.now}, ${input.now}
      )
    `
    yield* sql`
      INSERT INTO session_branch_state (
        branch_id, future_mode, waggle_preset_id, waggle_config_json,
        last_active_at, ui_state_json
      ) VALUES (
        ${branchId}, ${STANDARD_FUTURE_MODE}, ${null}, ${null},
        ${input.now}, ${DEFAULT_BRANCH_UI_STATE_JSON}
      )
    `
    yield* sql`
      INSERT INTO session_tree_ui_state (
        session_id, expanded_node_ids_json, expanded_node_ids_touched,
        branches_sidebar_collapsed, updated_at
      ) VALUES (
        ${input.session.sessionId}, ${EXPANDED_NODE_IDS_DEFAULT_JSON},
        ${EXPANDED_NODE_IDS_UNTOUCHED}, ${TREE_SIDEBAR_EXPANDED}, ${input.now}
      )
    `
    yield* sql`
      INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
      VALUES (${input.session.sessionId}, ${workspace.id}, ${input.now})
    `
    yield* sql`
      INSERT INTO session_execution_profiles (
        session_id, profile_json, resolved_agent_snapshot_json,
        authority_origin_caller_id, authority_scope_snapshot_json,
        authorization_ceiling, created_at, updated_at
      ) VALUES (
        ${input.session.sessionId}, ${JSON.stringify(input.executionSnapshot.profile)},
        ${
          input.executionSnapshot.resolvedAgentSnapshot === undefined
            ? null
            : JSON.stringify(input.executionSnapshot.resolvedAgentSnapshot)
        },
        ${authorityOriginCallerId},
        ${
          authorityScope
            ? encodeSessionAuthoritySnapshot({
                scope: authorityScope,
                projectPath,
                workingPath: workspace.working_path,
              })
            : null
        },
        ${input.executionSnapshot.authorizationCeiling}, ${input.now}, ${input.now}
      )
    `
  })
}

export function persistLifecycleSession(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  projectPath: string,
  workspace: LifecycleWorkspaceRow,
  authorityOriginCallerId: string,
  authorityScope?: ExecuteInput['callerAuthorityScope'],
) {
  return Effect.gen(function* () {
    yield* persistSessionMetadata(
      sql,
      input,
      projectPath,
      workspace,
      authorityOriginCallerId,
      authorityScope,
    )
    const operation = input.request.command.operation
    const startsRun = operation === 'launch' || operation === 'spawn'
    const runId = startsRun ? input.runId : undefined
    if (startsRun && !runId) {
      return yield* Effect.fail(repositoryError('run-identity-required', { operation }))
    }
    const intent = initialRunIntent(input)
    if (runId && intent) {
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (
          ${runId}, ${input.session.sessionId}, ${'starting'},
          ${JSON.stringify(intent)}, ${input.now}, ${input.now}
        )
      `
    }
    yield* sql`
      INSERT INTO session_control_states (
        session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
      ) VALUES (
        ${input.session.sessionId}, ${runId ? 1 : 0}, ${runId ?? null},
        ${'running'}, ${0}, ${input.now}
      )
    `
    if (operation === 'fork') {
      if (!input.forkSnapshot) {
        return yield* Effect.fail(repositoryError('fork-snapshot-required', { operation }))
      }
      yield* persistSessionSnapshotWithSql(
        sql,
        {
          sessionId: SessionId(input.session.sessionId),
          nodes: input.forkSnapshot.nodes,
          activeNodeId: input.forkSnapshot.activeNodeId,
          piSessionId: input.session.piSessionId,
          ...(input.session.piSessionFile ? { piSessionFile: input.session.piSessionFile } : {}),
        },
        input.now,
      )
    }
    return runId
  })
}
