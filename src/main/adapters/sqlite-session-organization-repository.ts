import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionOrganizationRepository,
  type SessionOrganizationRepositoryShape,
} from '../ports/session-organization-repository'
import { organizationOutcome, persistOrganizationMutation } from './session-organization-outcome'
import {
  newWorkspacePlan,
  type ResolveHandoffWorkspaceInput,
} from './session-organization-workspace-plan'
import { admitExistingHandoff } from './sqlite-session-existing-workspace-handoff-admission'
import {
  abortExistingHandoff,
  completeExistingHandoff,
} from './sqlite-session-existing-workspace-handoff-finalization'
import { completeHandoffCleanup } from './sqlite-session-handoff-cleanup'

interface OperationRow {
  readonly request_json: string
  readonly status: 'pending' | 'completed'
  readonly outcome_json: string | null
}

interface OrganizationSessionRow {
  readonly project_path: string | null
  readonly workspace_id: string | null
  readonly workspace_state: OrganizationWorkspaceRow['lifecycle_state'] | null
  readonly active_run_id: string | null
}

interface OrganizationWorkspaceRow {
  readonly id: string
  readonly project_path: string
  readonly kind: 'local' | 'managed-worktree'
  readonly working_path: string
  readonly lifecycle_state:
    | 'pending'
    | 'ready'
    | 'materializing'
    | 'missing'
    | 'releasing'
    | 'failed'
  readonly worktree_branch: string | null
  readonly worktree_base_ref: string | null
  readonly handoff_seed_ref: string | null
  readonly handoff_seed_base_ref: string | null
  readonly handoff_seed_state: 'none' | 'pending' | 'applied' | 'failed'
  readonly worktree_start_from_origin: number
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function loadOrganizationSession(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<OrganizationSessionRow>`
    SELECT
      sessions.project_path,
      session_workspace_bindings.workspace_id,
      workspace_resources.lifecycle_state AS workspace_state,
      session_control_states.active_run_id
    FROM sessions
    LEFT JOIN session_workspace_bindings
      ON session_workspace_bindings.session_id = sessions.id
    LEFT JOIN workspace_resources
      ON workspace_resources.id = session_workspace_bindings.workspace_id
    LEFT JOIN session_control_states
      ON session_control_states.session_id = sessions.id
    WHERE sessions.id = ${sessionId}
    LIMIT 1
  `
}

function loadWorkspace(sql: SqlClient.SqlClient, workspaceId: string) {
  return sql<OrganizationWorkspaceRow>`
    SELECT
      id, project_path, kind, working_path, lifecycle_state,
      worktree_branch, worktree_base_ref, handoff_seed_ref,
      handoff_seed_base_ref, handoff_seed_state, worktree_start_from_origin
    FROM workspace_resources WHERE id = ${workspaceId} LIMIT 1
  `
}

function resolveHandoffWorkspace(sql: SqlClient.SqlClient, input: ResolveHandoffWorkspaceInput) {
  return Effect.gen(function* () {
    if (input.workspace.mode === 'existing') {
      const rows = yield* loadWorkspace(sql, input.workspace.workspaceId)
      return rows[0] ?? null
    }
    const plan = newWorkspacePlan(input)
    const existing = yield* sql<OrganizationWorkspaceRow>`
      SELECT
        id, project_path, kind, working_path, lifecycle_state,
        worktree_branch, worktree_base_ref, handoff_seed_ref,
        handoff_seed_base_ref, handoff_seed_state, worktree_start_from_origin
      FROM workspace_resources
      WHERE project_path = ${input.projectPath} AND working_path = ${plan.workingPath}
      LIMIT 1
    `
    if (existing[0]) return existing[0]
    yield* sql`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state,
        worktree_branch, worktree_base_ref, handoff_seed_ref, handoff_seed_base_ref,
        handoff_seed_state, worktree_start_from_origin,
        created_at, updated_at
      ) VALUES (
        ${plan.id}, ${input.projectPath}, ${plan.kind}, ${plan.workingPath},
        ${plan.lifecycleState}, ${plan.worktreeBranch}, ${plan.worktreeBaseRef},
        ${plan.seedRef}, ${plan.seedBaseRef}, ${plan.seedState}, ${plan.startFromOrigin},
        ${input.now}, ${input.now}
      )
    `
    return {
      id: plan.id,
      project_path: input.projectPath,
      kind: plan.kind,
      working_path: plan.workingPath,
      lifecycle_state: plan.lifecycleState,
      worktree_branch: plan.worktreeBranch,
      worktree_base_ref: plan.worktreeBaseRef,
      handoff_seed_ref: plan.seedRef,
      handoff_seed_base_ref: plan.seedBaseRef,
      handoff_seed_state: plan.seedState,
      worktree_start_from_origin: plan.startFromOrigin,
    } satisfies OrganizationWorkspaceRow
  })
}

function applyHandoff(
  sql: SqlClient.SqlClient,
  command: Extract<
    Parameters<SessionOrganizationRepositoryShape['execute']>[0]['request']['command'],
    { operation: 'handoff' }
  >,
  session: OrganizationSessionRow,
  preparedHandoff: Parameters<SessionOrganizationRepositoryShape['execute']>[0]['preparedHandoff'],
  now: number,
) {
  return Effect.gen(function* () {
    if (
      !session.workspace_id ||
      !session.project_path ||
      (session.workspace_state !== 'ready' && session.workspace_state !== 'pending')
    ) {
      return null
    }
    if (session.active_run_id) return null
    const workspace = yield* resolveHandoffWorkspace(sql, {
      sessionId: command.sessionId,
      projectPath: session.project_path,
      workspace: command.workspace,
      now,
      ...(preparedHandoff ? { preparedHandoff } : {}),
    })
    if (
      !workspace ||
      workspace.project_path !== session.project_path ||
      (workspace.lifecycle_state !== 'ready' && workspace.lifecycle_state !== 'pending')
    ) {
      return null
    }
    yield* sql`
      UPDATE session_workspace_bindings
      SET workspace_id = ${workspace.id}, bound_at = ${now}
      WHERE session_id = ${command.sessionId}
    `
    yield* sql`
      UPDATE sessions
      SET environment_mode = ${workspace.kind === 'managed-worktree' ? 'worktree' : 'local'},
          worktree_path = ${
            workspace.kind === 'managed-worktree' && workspace.lifecycle_state === 'ready'
              ? workspace.working_path
              : null
          },
          worktree_base_ref = ${workspace.worktree_base_ref},
          worktree_start_from_origin = ${workspace.worktree_start_from_origin},
          updated_at = ${now}
      WHERE id = ${command.sessionId}
    `
    yield* sql`
      DELETE FROM workspace_resources
      WHERE id = ${session.workspace_id}
        AND lifecycle_state = ${'pending'}
        AND NOT EXISTS (
          SELECT 1 FROM session_workspace_bindings
          WHERE workspace_id = ${session.workspace_id}
        )
    `
    return {
      operation: 'handoff',
      effect: 'session-handed-off',
      sessionId: command.sessionId,
      previousWorkspaceId: session.workspace_id,
      workspaceId: workspace.id,
      workspaceState: workspace.lifecycle_state,
    } satisfies SessionControlMutationOutcome
  })
}

function executeOrganization(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionOrganizationRepositoryShape['execute']>[0],
) {
  const command = input.request.command
  const requestJson = canonicalJson(command)
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const existingRows = yield* sql<OperationRow>`
        SELECT request_json, status, outcome_json FROM session_operations
        WHERE caller_id = ${input.callerId} AND operation = ${command.operation}
          AND target_scope = ${command.sessionId}
          AND idempotency_key = ${input.request.idempotencyKey}
        LIMIT 1
      `
        const existing = existingRows[0]
        if (existing) {
          if (existing.request_json !== requestJson || !existing.outcome_json) {
            return yield* Effect.fail(
              repositoryError('organization-idempotency-key-reused', command),
            )
          }
          const outcome = decodeSessionControlMutationOutcome(
            parseJsonUnknown(existing.outcome_json),
          )
          return { outcome, replayed: true }
        }
        const sessions = yield* loadOrganizationSession(sql, command.sessionId)
        const session = sessions[0]
        const now = Date.now()
        const handoffOutcome =
          command.operation === 'handoff' && session && !input.preparationRejectionCode
            ? yield* applyHandoff(sql, command, session, input.preparedHandoff, now)
            : undefined
        const outcome = session
          ? command.operation === 'handoff'
            ? (handoffOutcome ?? {
                operation: command.operation,
                effect: 'rejected',
                sessionId: command.sessionId,
                code:
                  input.preparationRejectionCode ??
                  (session.active_run_id ? 'session_not_idle' : 'workspace_unavailable'),
              })
            : organizationOutcome(command)
          : ({
              operation: command.operation,
              effect: 'rejected',
              sessionId: command.sessionId,
              code: 'session_not_found',
            } satisfies SessionControlMutationOutcome)
        if (outcome.effect !== 'rejected') {
          if (command.operation !== 'handoff') yield* persistOrganizationMutation(sql, command, now)
        }
        yield* sql`INSERT INTO session_operations (
        caller_id, operation, target_scope, idempotency_key, request_json,
        status, outcome_json, created_at, updated_at
      ) VALUES (
        ${input.callerId}, ${command.operation}, ${command.sessionId},
        ${input.request.idempotencyKey}, ${requestJson}, ${'completed'},
        ${JSON.stringify(outcome)}, ${now}, ${now}
      )`
        return { outcome, replayed: false }
      }),
    )
    .pipe(
      Effect.map(({ outcome, replayed }) => ({
        contractVersion: input.request.contractVersion,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed,
        outcome,
      })),
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('execute-session-organization', cause),
      ),
    )
}

export const SqliteSessionOrganizationRepositoryLive = Layer.effect(
  SessionOrganizationRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionOrganizationRepository.of({
      execute: (input) => executeOrganization(sql, input),
      admitExistingHandoff: (input) => admitExistingHandoff(sql, input),
      completeExistingHandoff: (input) => completeExistingHandoff(sql, input),
      abortExistingHandoff: (input) => abortExistingHandoff(sql, input),
      completeHandoffCleanup: (input) => completeHandoffCleanup(sql, input),
    })
  }),
)
