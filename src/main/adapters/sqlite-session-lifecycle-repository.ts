import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionLifecycleRepositoryError } from '../errors'
import {
  SessionLifecycleRepository,
  type SessionLifecycleRepositoryShape,
} from '../ports/session-lifecycle-repository'
import {
  findLifecycleReplay,
  type LifecycleTarget,
  resolveLifecycleTarget,
} from './sqlite-session-lifecycle-admission'
import { lifecycleOutcome } from './sqlite-session-lifecycle-outcome'
import { persistLifecycleSession } from './sqlite-session-lifecycle-persistence'
import {
  lifecycleResponse,
  resolveLifecycleWorkspace,
  storeLifecycleOutcome,
} from './sqlite-session-lifecycle-support'
import { liveSessionAuthorityBlockReason } from './sqlite-session-live-authority'

function repositoryError(operation: string, cause: unknown) {
  return new SessionLifecycleRepositoryError({ operation, cause })
}

function targetScopeForRequest(
  request: Parameters<NonNullable<SessionLifecycleRepositoryShape['findReplay']>>[0]['request'],
) {
  const command = request.command
  if (command.operation === 'spawn') return `parent:${command.parentSessionId}`
  if (command.operation === 'fork') return `source:${command.sourceSessionId}`
  return `project:${command.projectPath}`
}

function sourceSessionId(callerId: string) {
  const prefix = 'session-agent:'
  if (!callerId.startsWith(prefix)) return undefined
  const lastSeparator = callerId.lastIndexOf(':')
  if (lastSeparator <= prefix.length) return undefined
  return callerId.slice(prefix.length, lastSeparator)
}

function resolveAuthorityOrigin(
  sql: SqlClient.SqlClient,
  callerId: string,
  callerAuthorityScope: Parameters<
    SessionLifecycleRepositoryShape['execute']
  >[0]['callerAuthorityScope'],
) {
  const sessionId = sourceSessionId(callerId)
  if (!sessionId) return Effect.succeed({ callerId, scope: callerAuthorityScope })
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly authority_origin_caller_id: string
      readonly authority_scope_snapshot_json: string | null
    }>`
      SELECT authority_origin_caller_id, authority_scope_snapshot_json
      FROM session_execution_profiles
      WHERE session_id = ${sessionId}
      LIMIT 1
    `
    const origin = rows[0]
    if (!origin) return { callerId, scope: callerAuthorityScope }
    const snapshot = origin.authority_scope_snapshot_json
      ? JSON.parse(origin.authority_scope_snapshot_json)
      : undefined
    return {
      callerId: origin.authority_origin_caller_id || callerId,
      scope: snapshot?.scope ?? callerAuthorityScope,
    }
  })
}

function execute(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionLifecycleRepositoryShape['execute']>[0],
) {
  const scope = targetScopeForRequest(input.request)
  const requestJson = canonicalJson(input.request.command)
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const replay = yield* findLifecycleReplay(sql, input, scope, requestJson)
        if (replay) return replay

        const authorityBlock = yield* liveSessionAuthorityBlockReason(sql, input.callerId)
        if (authorityBlock) {
          const outcome = {
            operation: input.request.command.operation,
            effect: 'rejected' as const,
            code: authorityBlock,
            retryable: false,
          }
          yield* storeLifecycleOutcome(sql, input, scope, requestJson, outcome)
          return lifecycleResponse(input, false, outcome)
        }

        const resolution = yield* resolveLifecycleTarget(sql, input, scope, requestJson)
        if (resolution.kind === 'rejected') return resolution.response
        const target: LifecycleTarget = resolution.target
        const authorityOrigin = yield* resolveAuthorityOrigin(
          sql,
          input.callerId,
          input.callerAuthorityScope,
        )

        const workspace = yield* resolveLifecycleWorkspace(
          sql,
          input.workspacePlan,
          target.parentSessionId,
          input.now,
        )
        if (workspace.project_path !== target.projectPath) {
          return yield* Effect.fail(
            repositoryError('workspace-project-mismatch', {
              projectPath: target.projectPath,
              workspaceProjectPath: workspace.project_path,
            }),
          )
        }

        const runId = yield* persistLifecycleSession(
          sql,
          input,
          target.projectPath,
          workspace,
          authorityOrigin.callerId,
          authorityOrigin.scope,
        )
        const outcome = yield* lifecycleOutcome(sql, input, {
          workspaceId: workspace.id,
          authorityOriginCallerId: authorityOrigin.callerId,
          runId,
          parentSessionId: target.parentSessionId,
          parentRunId: target.parentRunId,
          hiveRootSessionId: target.hiveRootSessionId,
          depth: target.depth,
        })
        yield* storeLifecycleOutcome(sql, input, scope, requestJson, outcome)
        return lifecycleResponse(input, false, outcome)
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionLifecycleRepositoryError
          ? cause
          : repositoryError('execute-lifecycle', cause),
      ),
    )
}

function findReplay(
  sql: SqlClient.SqlClient,
  input: Parameters<NonNullable<SessionLifecycleRepositoryShape['findReplay']>>[0],
) {
  const scope = targetScopeForRequest(input.request)
  const requestJson = canonicalJson(input.request.command)
  return findLifecycleReplay(sql, input, scope, requestJson).pipe(
    Effect.mapError((cause) =>
      cause instanceof SessionLifecycleRepositoryError
        ? cause
        : repositoryError('find-lifecycle-replay', cause),
    ),
  )
}

export const SqliteSessionLifecycleRepositoryLive = Layer.effect(
  SessionLifecycleRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionLifecycleRepository.of({
      findReplay: (input) => findReplay(sql, input),
      execute: (input) => execute(sql, input),
    })
  }),
)
