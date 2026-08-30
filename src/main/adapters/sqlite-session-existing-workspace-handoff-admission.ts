import type * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import type { SessionOrganizationRepositoryShape } from '../ports/session-organization-repository'

type AdmissionInput = Parameters<SessionOrganizationRepositoryShape['admitExistingHandoff']>[0]

interface OperationRow {
  readonly request_json: string
  readonly status: 'pending' | 'completed'
  readonly outcome_json: string | null
}

interface SessionRow {
  readonly project_path: string | null
  readonly workspace_id: string | null
  readonly workspace_state: string | null
  readonly active_run_id: string | null
}

interface WorkspaceRow {
  readonly id: string
  readonly project_path: string
  readonly lifecycle_state: string
  readonly handoff_seed_ref: string | null
  readonly handoff_seed_base_ref: string | null
  readonly bound_session_count: number
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function response(
  input: AdmissionInput,
  outcome: SessionControlMutationOutcome,
  replayed: boolean,
) {
  return {
    contractVersion: input.request.contractVersion,
    requestId: input.request.requestId,
    idempotencyKey: input.request.idempotencyKey,
    replayed,
    outcome,
  }
}

function loadOperation(sql: SqlClient.SqlClient, input: AdmissionInput) {
  return sql<OperationRow>`
    SELECT request_json, status, outcome_json FROM session_operations
    WHERE caller_id = ${input.callerId} AND operation = ${'handoff'}
      AND target_scope = ${input.request.command.sessionId}
      AND idempotency_key = ${input.request.idempotencyKey}
    LIMIT 1
  `
}

function loadSession(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<SessionRow>`
    SELECT sessions.project_path, session_workspace_bindings.workspace_id,
      workspace_resources.lifecycle_state AS workspace_state,
      session_control_states.active_run_id
    FROM sessions
    LEFT JOIN session_workspace_bindings
      ON session_workspace_bindings.session_id = sessions.id
    LEFT JOIN workspace_resources
      ON workspace_resources.id = session_workspace_bindings.workspace_id
    LEFT JOIN session_control_states ON session_control_states.session_id = sessions.id
    WHERE sessions.id = ${sessionId} LIMIT 1
  `
}

function loadWorkspace(sql: SqlClient.SqlClient, workspaceId: string) {
  return sql<WorkspaceRow>`
    SELECT id, project_path, lifecycle_state, handoff_seed_ref, handoff_seed_base_ref,
      (SELECT COUNT(*) FROM session_workspace_bindings
        WHERE workspace_id = workspace_resources.id) AS bound_session_count
    FROM workspace_resources WHERE id = ${workspaceId} LIMIT 1
  `
}

function admitted(input: AdmissionInput, previousWorkspaceId: string) {
  return {
    status: 'admitted',
    handoff: { previousWorkspaceId, workspaceId: input.preparedHandoff.workspaceId },
  } as const
}

function requestMismatch(operation: OperationRow | undefined, requestJson: string) {
  return operation?.request_json !== undefined && operation.request_json !== requestJson
}

function pendingAdmissionMatches(
  input: AdmissionInput,
  operation: OperationRow | undefined,
  session: SessionRow | undefined,
  target: WorkspaceRow | undefined,
) {
  return (
    operation?.status === 'pending' &&
    session !== undefined &&
    target !== undefined &&
    !session.active_run_id &&
    !!session.workspace_id &&
    session.workspace_id !== target.id &&
    session.project_path === target.project_path &&
    session.workspace_state === 'ready' &&
    target.lifecycle_state === 'materializing' &&
    target.bound_session_count === 0 &&
    target.handoff_seed_ref === input.preparedHandoff.snapshotRef &&
    target.handoff_seed_base_ref === input.preparedHandoff.sourceHead
  )
}

function resumedAdmission(
  input: AdmissionInput,
  operation: OperationRow | undefined,
  session: SessionRow | undefined,
  target: WorkspaceRow | undefined,
) {
  if (!pendingAdmissionMatches(input, operation, session, target)) return
  return session?.workspace_id ? admitted(input, session.workspace_id) : undefined
}

function freshAdmissionAvailable(
  session: SessionRow | undefined,
  target: WorkspaceRow | undefined,
) {
  return (
    session !== undefined &&
    target !== undefined &&
    !session.active_run_id &&
    !!session.workspace_id &&
    session.workspace_id !== target.id &&
    session.project_path === target.project_path &&
    session.workspace_state === 'ready' &&
    target.lifecycle_state === 'ready' &&
    target.bound_session_count === 0
  )
}

function rejectionCode(session: SessionRow | undefined) {
  if (!session) return 'session_not_found'
  return session.active_run_id ? 'session_not_idle' : 'workspace_unavailable'
}

function rejectionOutcome(input: AdmissionInput, code: string) {
  return {
    operation: 'handoff',
    effect: 'rejected',
    sessionId: input.request.command.sessionId,
    code,
  } satisfies SessionControlMutationOutcome
}

function persistRejection(
  sql: SqlClient.SqlClient,
  input: AdmissionInput,
  outcome: SessionControlMutationOutcome,
  now: number,
) {
  return sql`INSERT INTO session_operations (
    caller_id, operation, target_scope, idempotency_key, request_json,
    status, outcome_json, created_at, updated_at
  ) VALUES (
    ${input.callerId}, ${'handoff'}, ${input.request.command.sessionId},
    ${input.request.idempotencyKey}, ${canonicalJson(input.request.command)},
    ${'completed'}, ${JSON.stringify(outcome)}, ${now}, ${now}
  )`
}

export function admitExistingHandoff(sql: SqlClient.SqlClient, input: AdmissionInput) {
  const requestJson = canonicalJson(input.request.command)
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const operation = (yield* loadOperation(sql, input))[0]
        if (requestMismatch(operation, requestJson)) {
          return yield* Effect.fail(
            repositoryError('organization-idempotency-key-reused', input.request.command),
          )
        }
        if (operation?.status === 'completed' && operation.outcome_json) {
          const outcome = decodeSessionControlMutationOutcome(
            parseJsonUnknown(operation.outcome_json),
          )
          return { status: 'completed', response: response(input, outcome, true) } as const
        }

        const session = (yield* loadSession(sql, input.request.command.sessionId))[0]
        const target = (yield* loadWorkspace(sql, input.preparedHandoff.workspaceId))[0]
        const resumed = resumedAdmission(input, operation, session, target)
        if (resumed) return resumed
        if (operation?.status === 'pending') {
          return yield* Effect.fail(
            repositoryError('resume-existing-workspace-handoff', input.request.command),
          )
        }
        if (!freshAdmissionAvailable(session, target) || !session?.workspace_id || !target) {
          const outcome = rejectionOutcome(input, rejectionCode(session))
          const now = Date.now()
          yield* persistRejection(sql, input, outcome, now)
          return { status: 'completed', response: response(input, outcome, false) } as const
        }

        const now = Date.now()
        yield* sql`
          UPDATE workspace_resources
          SET lifecycle_state = ${'materializing'},
              handoff_seed_ref = ${input.preparedHandoff.snapshotRef},
              handoff_seed_base_ref = ${input.preparedHandoff.sourceHead},
              handoff_seed_state = ${'pending'}, updated_at = ${now}
          WHERE id = ${target.id} AND lifecycle_state = ${'ready'}
        `
        yield* sql`INSERT INTO session_operations (
          caller_id, operation, target_scope, idempotency_key, request_json,
          status, outcome_json, created_at, updated_at
        ) VALUES (
          ${input.callerId}, ${'handoff'}, ${input.request.command.sessionId},
          ${input.request.idempotencyKey}, ${requestJson}, ${'pending'}, ${null}, ${now}, ${now}
        )`
        return admitted(input, session.workspace_id)
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('admit-existing-workspace-handoff', cause),
      ),
    )
}
