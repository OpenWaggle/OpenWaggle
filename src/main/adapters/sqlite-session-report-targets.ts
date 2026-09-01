import type * as SqlClient from '@effect/sql/SqlClient'
import { normalizeSessionReportReference } from '@shared/session-report-reference'
import { SessionId } from '@shared/types/brand'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionControlReportTarget } from '@shared/types/session-collaboration'
import * as Effect from 'effect/Effect'
import type { AuthorizedReportCandidate } from '../domain/session-control/report-target-resolution'
import { authorizedSessionScope } from './sqlite-session-query-support'

export interface ReportSourceRow {
  readonly session_id: string
  readonly parent_session_id: string | null
  readonly hive_root_session_id: string | null
}

interface ReportCandidateRow {
  readonly session_id: string
  readonly title: string
  readonly agent_name: string | null
}

// A unique reference needs one row; a second row proves ambiguity. Never hydrate
// the remainder of a large same-name catalog into the report transaction.
const REPORT_REFERENCE_CANDIDATE_LIMIT = 2

function implicitLineageAllowed(authority: LocalSessionProfileAuthority | undefined) {
  return !authority || authority.profileId.startsWith('session-agent:') ? 1 : 0
}

function referenceCandidates(rows: readonly ReportCandidateRow[]): AuthorizedReportCandidate[] {
  return rows.map((row) => ({
    sessionId: SessionId(row.session_id),
    referenceNames: [row.session_id, row.title, ...(row.agent_name ? [row.agent_name] : [])],
  }))
}

function lineageTargetId(source: ReportSourceRow, target: SessionControlReportTarget) {
  if (target.type === 'upstream') return source.parent_session_id
  if (target.type === 'queen') return source.hive_root_session_id
  return null
}

function loadLineageCandidate(
  sql: SqlClient.SqlClient,
  source: ReportSourceRow,
  target: Extract<SessionControlReportTarget, { readonly type: 'upstream' | 'queen' }>,
  authority: LocalSessionProfileAuthority | undefined,
) {
  const targetId = lineageTargetId(source, target)
  if (!targetId) return Effect.succeed<readonly ReportCandidateRow[]>([])
  const allowed = authorizedSessionScope(authority)
  const lineageAllowed = implicitLineageAllowed(authority)
  return sql<ReportCandidateRow>`
    SELECT sessions.id AS session_id, sessions.title,
      CASE WHEN json_valid(session_execution_profiles.profile_json)
        THEN json_extract(session_execution_profiles.profile_json, '$.agentDefinitionName')
        ELSE NULL
      END AS agent_name
    FROM sessions
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN session_execution_profiles
      ON session_execution_profiles.session_id = sessions.id
    WHERE sessions.id = ${targetId}
      AND sessions.id <> ${source.session_id}
      AND (
        ${lineageAllowed} = 1
        OR
        ${allowed.all} = 1
        OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR lineage.hive_root_session_id IN ${sql.in(allowed.hiveRootSessionIds)}
        OR sessions.id IN ${sql.in(allowed.hiveRootSessionIds)}
      )
    LIMIT 1
  `
}

function loadExplicitCandidates(
  sql: SqlClient.SqlClient,
  source: ReportSourceRow,
  target: Extract<SessionControlReportTarget, { readonly type: 'session' | 'sessions' }>,
  authority: LocalSessionProfileAuthority | undefined,
) {
  const requestedIds = [
    ...new Set(target.type === 'session' ? [target.sessionId] : target.sessionIds),
  ]
  if (requestedIds.length === 0) return Effect.succeed<readonly ReportCandidateRow[]>([])
  const allowed = authorizedSessionScope(authority)
  const lineageAllowed = implicitLineageAllowed(authority)
  return sql<ReportCandidateRow>`
    SELECT sessions.id AS session_id, sessions.title,
      CASE WHEN json_valid(session_execution_profiles.profile_json)
        THEN json_extract(session_execution_profiles.profile_json, '$.agentDefinitionName')
        ELSE NULL
      END AS agent_name
    FROM sessions
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN session_execution_profiles
      ON session_execution_profiles.session_id = sessions.id
    WHERE sessions.id IN (SELECT value FROM json_each(${JSON.stringify(requestedIds)}))
      AND sessions.id <> ${source.session_id}
      AND (
        (${lineageAllowed} = 1 AND (
          sessions.id = ${source.parent_session_id}
          OR sessions.id = ${source.hive_root_session_id}
          OR lineage.parent_session_id = ${source.session_id}
        ))
        OR ${allowed.all} = 1
        OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR lineage.hive_root_session_id IN ${sql.in(allowed.hiveRootSessionIds)}
      )
    ORDER BY sessions.id
  `
}

function loadReferenceCandidates(
  sql: SqlClient.SqlClient,
  source: ReportSourceRow,
  target: Extract<SessionControlReportTarget, { readonly type: 'worker-reference' }>,
  authority: LocalSessionProfileAuthority | undefined,
) {
  const allowed = authorizedSessionScope(authority)
  const lineageAllowed = implicitLineageAllowed(authority)
  const normalizedReference = normalizeSessionReportReference(target.reference)
  return sql<ReportCandidateRow>`
    SELECT DISTINCT sessions.id AS session_id, sessions.title,
      CASE WHEN json_valid(session_execution_profiles.profile_json)
        THEN json_extract(session_execution_profiles.profile_json, '$.agentDefinitionName')
        ELSE NULL
      END AS agent_name
    FROM session_report_references AS report_references
    JOIN sessions ON sessions.id = report_references.session_id
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN session_execution_profiles
      ON session_execution_profiles.session_id = sessions.id
    WHERE report_references.normalized_reference = ${normalizedReference}
      AND sessions.id <> ${source.session_id}
      AND (
        (${lineageAllowed} = 1 AND (
          sessions.id = ${source.parent_session_id}
          OR sessions.id = ${source.hive_root_session_id}
          OR lineage.parent_session_id = ${source.session_id}
        ))
        OR ${allowed.all} = 1
        OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR lineage.hive_root_session_id IN ${sql.in(allowed.hiveRootSessionIds)}
      )
    ORDER BY sessions.id
    LIMIT ${REPORT_REFERENCE_CANDIDATE_LIMIT}
  `
}

export function loadAuthorizedReportCandidates(
  sql: SqlClient.SqlClient,
  input: {
    readonly source: ReportSourceRow
    readonly target: SessionControlReportTarget
    readonly authority?: LocalSessionProfileAuthority
  },
) {
  const { source, target } = input
  const rows =
    target.type === 'upstream' || target.type === 'queen'
      ? loadLineageCandidate(sql, source, target, input.authority)
      : target.type === 'session' || target.type === 'sessions'
        ? loadExplicitCandidates(sql, source, target, input.authority)
        : loadReferenceCandidates(sql, source, target, input.authority)
  return rows.pipe(Effect.map(referenceCandidates))
}
