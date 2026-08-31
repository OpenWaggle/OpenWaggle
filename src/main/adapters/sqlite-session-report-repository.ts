import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import { SessionId } from '@shared/types/brand'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationOutcome,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  type AuthorizedReportCandidate,
  resolveReportTargets,
} from '../domain/session-control/report-target-resolution'
import { authorizeSessionTarget } from '../domain/session-control/session-capability-authorization'
import { SessionControlRepositoryError } from '../errors'
import {
  type ExecuteSessionReportInput,
  SessionReportRepository,
} from '../ports/session-report-repository'
import { listPendingReports, markReportsDelivered } from './sqlite-session-report-delivery'
import { resolveReportCorrelationId, sourceRunAuthorized } from './sqlite-session-report-validation'

interface ReportSourceRow {
  readonly session_id: string
  readonly parent_session_id: string | null
  readonly hive_root_session_id: string | null
}

interface ReportCandidateRow {
  readonly session_id: string
  readonly title: string
  readonly project_path: string | null
  readonly hive_root_session_id: string | null
  readonly agent_name: string | null
  readonly parent_session_id: string | null
}

interface ReplayRow {
  readonly request_json: string
  readonly outcome_json: string | null
  readonly status: string
}

function reportError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function response(
  input: ExecuteSessionReportInput,
  replayed: boolean,
  outcome: SessionControlMutationOutcome,
) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: input.request.requestId,
    idempotencyKey: input.request.idempotencyKey,
    replayed,
    outcome,
  } as const
}

function reportScope(input: ExecuteSessionReportInput) {
  return `source:${input.request.command.sessionId}`
}

function isNarrowRoute(source: ReportSourceRow, candidate: ReportCandidateRow) {
  return (
    candidate.session_id === source.parent_session_id ||
    candidate.session_id === source.hive_root_session_id ||
    candidate.parent_session_id === source.session_id
  )
}

function candidateAuthorized(
  source: ReportSourceRow,
  candidate: ReportCandidateRow,
  authority: LocalSessionProfileAuthority | undefined,
) {
  if (isNarrowRoute(source, candidate)) return true
  return authorizeSessionTarget(authority, {
    sessionId: candidate.session_id,
    ...(candidate.project_path ? { projectPath: candidate.project_path } : {}),
    ...(candidate.hive_root_session_id
      ? { hiveRootSessionId: candidate.hive_root_session_id }
      : {}),
  }).authorized
}

function referenceCandidates(rows: readonly ReportCandidateRow[]): AuthorizedReportCandidate[] {
  return rows.map((row) => ({
    sessionId: SessionId(row.session_id),
    referenceNames: [row.session_id, row.title, ...(row.agent_name ? [row.agent_name] : [])],
  }))
}

function brandedReportTarget(target: ExecuteSessionReportInput['request']['command']['target']) {
  if (target.type === 'session')
    return { type: target.type, sessionId: SessionId(target.sessionId) } as const
  if (target.type === 'sessions') {
    return { type: target.type, sessionIds: target.sessionIds.map(SessionId) } as const
  }
  return target
}

function findReplay(
  sql: SqlClient.SqlClient,
  input: ExecuteSessionReportInput,
  requestJson: string,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<ReplayRow>`
      SELECT request_json, outcome_json, status
      FROM session_operations
      WHERE caller_id = ${input.callerId}
        AND operation = ${'report'}
        AND target_scope = ${reportScope(input)}
        AND idempotency_key = ${input.request.idempotencyKey}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return undefined
    if (row.request_json !== requestJson || row.status !== 'completed' || !row.outcome_json) {
      return yield* Effect.fail(reportError('report-idempotency-conflict', { row }))
    }
    return response(input, true, decodeSessionControlMutationOutcome(JSON.parse(row.outcome_json)))
  })
}

function storeOutcome(
  sql: SqlClient.SqlClient,
  input: ExecuteSessionReportInput,
  requestJson: string,
  outcome: SessionControlMutationOutcome,
) {
  return sql`
    INSERT INTO session_operations (
      caller_id, operation, target_scope, idempotency_key, request_json,
      status, outcome_json, created_at, updated_at
    ) VALUES (
      ${input.callerId}, ${'report'}, ${reportScope(input)}, ${input.request.idempotencyKey},
      ${requestJson}, ${'completed'}, ${JSON.stringify(outcome)}, ${input.now}, ${input.now}
    )
  `
}

function rejectReport(
  sql: SqlClient.SqlClient,
  input: ExecuteSessionReportInput,
  requestJson: string,
  sessionId: string,
  code: string,
) {
  return Effect.gen(function* () {
    const outcome = {
      operation: 'report',
      effect: 'rejected',
      sessionId,
      code,
    } as const
    yield* storeOutcome(sql, input, requestJson, outcome)
    return response(input, false, outcome)
  })
}

function executeReport(sql: SqlClient.SqlClient, input: ExecuteSessionReportInput) {
  const requestJson = canonicalJson(input.request.command)
  return sql.withTransaction(
    Effect.gen(function* () {
      const replay = yield* findReplay(sql, input, requestJson)
      if (replay) return replay
      const sourceRows = yield* sql<ReportSourceRow>`
        SELECT sessions.id AS session_id,
          session_spawn_lineage.parent_session_id,
          session_spawn_lineage.hive_root_session_id
        FROM sessions
        LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
        WHERE sessions.id = ${input.request.command.sessionId}
        LIMIT 1
      `
      const source = sourceRows[0]
      if (!source) {
        return yield* rejectReport(
          sql,
          input,
          requestJson,
          input.request.command.sessionId,
          'source_not_found',
        )
      }
      const candidateRows = yield* sql<ReportCandidateRow>`
        SELECT sessions.id AS session_id, sessions.title, sessions.project_path,
          lineage.hive_root_session_id, lineage.parent_session_id,
          json_extract(session_execution_profiles.profile_json, '$.agentDefinitionName') AS agent_name
        FROM sessions
        LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
        LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
        WHERE sessions.id <> ${source.session_id}
        ORDER BY sessions.id
      `
      const authorizedRows = candidateRows.filter((candidate) =>
        candidateAuthorized(source, candidate, input.authority),
      )
      const resolution = resolveReportTargets({
        selector: brandedReportTarget(input.request.command.target),
        source: {
          sessionId: SessionId(source.session_id),
          parentSessionId: source.parent_session_id ? SessionId(source.parent_session_id) : null,
          queenSessionId: source.hive_root_session_id
            ? SessionId(source.hive_root_session_id)
            : null,
        },
        authorizedCandidates: referenceCandidates(authorizedRows),
      })
      if (input.request.command.input.text.trim().length === 0) {
        return yield* rejectReport(sql, input, requestJson, source.session_id, 'report_empty')
      }
      if (!resolution.resolved) {
        return yield* rejectReport(sql, input, requestJson, source.session_id, resolution.code)
      }
      if (!(yield* sourceRunAuthorized(sql, input, source.session_id))) {
        return yield* rejectReport(
          sql,
          input,
          requestJson,
          source.session_id,
          'source_run_not_authorized',
        )
      }
      const targetIds = resolution.targetSessionIds.map(String)
      if (targetIds.some((id) => !authorizedRows.some((row) => row.session_id === id))) {
        return yield* rejectReport(
          sql,
          input,
          requestJson,
          source.session_id,
          'target_not_authorized',
        )
      }
      const replyTo = input.request.command.input.replyToReportId
      const correlation = yield* resolveReportCorrelationId(sql, input, targetIds)
      if (!correlation.valid) {
        return yield* rejectReport(
          sql,
          input,
          requestJson,
          source.session_id,
          'reply_target_mismatch',
        )
      }
      const correlationId = correlation.correlationId
      yield* sql`
        INSERT INTO cross_session_reports (
          id, correlation_id, reply_to_report_id, source_session_id, source_run_id,
          authored_by, content, request_reply, created_at
        ) VALUES (
          ${input.reportId}, ${correlationId}, ${replyTo ?? null}, ${source.session_id},
          ${input.request.command.sourceRunId ?? null}, ${input.callerId},
          ${input.request.command.input.text},
          ${input.request.command.input.requestReply ? 1 : 0}, ${input.now}
        )
      `
      for (const targetSessionId of targetIds) {
        yield* sql`
          INSERT INTO cross_session_report_deliveries (
            report_id, target_session_id, status, created_at
          ) VALUES (${input.reportId}, ${targetSessionId}, ${'pending'}, ${input.now})
        `
      }
      const outcome = {
        operation: 'report',
        effect: 'accepted-report',
        sessionId: source.session_id,
        reportId: input.reportId,
        correlationId,
        targetSessionIds: targetIds,
        deliveryStates: targetIds.map((sessionId) => ({ sessionId, status: 'pending' as const })),
      } as const
      yield* storeOutcome(sql, input, requestJson, outcome)
      return response(input, false, outcome)
    }),
  )
}

export const SqliteSessionReportRepositoryLive = Layer.effect(
  SessionReportRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionReportRepository.of({
      execute: (input) =>
        executeReport(sql, input).pipe(
          Effect.mapError((cause) =>
            cause instanceof SessionControlRepositoryError
              ? cause
              : reportError('execute-report', cause),
          ),
        ),
      listPending: ({ targetSessionId }) =>
        listPendingReports(sql, targetSessionId).pipe(
          Effect.mapError((cause) => reportError('list-pending-reports', cause)),
        ),
      markDelivered: (input) =>
        markReportsDelivered(sql, input).pipe(
          Effect.mapError((cause) =>
            cause instanceof SessionControlRepositoryError
              ? cause
              : reportError('mark-report-delivered', cause),
          ),
        ),
    })
  }),
)
