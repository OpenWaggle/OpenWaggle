import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  DelegationConflictKind,
  DelegationConflictStatus,
} from '@shared/types/session-delegation-query'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  authorizedSessionScope,
  decodeSessionQueryCursor,
  encodeSessionQueryCursor,
  invalidSessionQueryCursor,
  parseSessionJson,
  sessionQueryResponse,
} from './sqlite-session-query-support'

type ConflictRequest = SessionQueryRequest & {
  readonly query: Extract<
    SessionQueryRequest['query'],
    { readonly operation: 'delegations-conflicts' }
  >
}

interface ConflictCatalogRow {
  readonly id: string
  readonly left_delegation_id: string
  readonly right_delegation_id: string
  readonly left_worker_session_id: string
  readonly right_worker_session_id: string
  readonly kind: DelegationConflictKind
  readonly evidence_json: string
  readonly acknowledged_by: string | null
  readonly acknowledgement_reason: string | null
  readonly acknowledged_at: number | null
  readonly resolved_at: number | null
  readonly created_at: number
}

function conflictCursor(request: ConflictRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return 'invalid' as const
  if (!cursor) return null
  return typeof cursor.createdAt === 'number' && typeof cursor.conflictId === 'string'
    ? { createdAt: cursor.createdAt, conflictId: cursor.conflictId }
    : ('invalid' as const)
}

function conflictStatus(row: ConflictCatalogRow): DelegationConflictStatus {
  if (row.resolved_at !== null) return 'resolved'
  return row.acknowledged_by === null ? 'unacknowledged' : 'acknowledged'
}

function conflictSummary(row: ConflictCatalogRow) {
  return {
    conflictId: row.id,
    leftDelegationId: row.left_delegation_id,
    rightDelegationId: row.right_delegation_id,
    leftWorkerSessionId: row.left_worker_session_id,
    rightWorkerSessionId: row.right_worker_session_id,
    kind: row.kind,
    status: conflictStatus(row),
    evidence: parseSessionJson(row.evidence_json),
    ...(row.acknowledged_by ? { acknowledgedBy: row.acknowledged_by } : {}),
    ...(row.acknowledgement_reason ? { acknowledgementReason: row.acknowledgement_reason } : {}),
    ...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
    createdAt: row.created_at,
  }
}

function conflictListResponse(request: ConflictRequest, rows: readonly ConflictCatalogRow[]) {
  const page = rows.slice(0, request.query.limit)
  const last = page.at(-1)
  return sessionQueryResponse(request, {
    operation: 'delegations-conflicts',
    conflicts: page.map(conflictSummary),
    ...(rows.length > request.query.limit && last
      ? {
          nextCursor: encodeSessionQueryCursor({
            createdAt: last.created_at,
            conflictId: last.id,
          }),
        }
      : {}),
  })
}

function kindSelection(query: ConflictRequest['query']) {
  const defaultKinds: readonly DelegationConflictKind[] = ['live-overlap']
  return {
    selected: query.kinds?.length ? 1 : 0,
    kinds: query.kinds?.length ? query.kinds : defaultKinds,
  }
}

function statusSelection(query: ConflictRequest['query']) {
  return {
    selected: query.statuses?.length ? 1 : 0,
    allowUnacknowledged: query.statuses?.includes('unacknowledged') ? 1 : 0,
    allowAcknowledged: query.statuses?.includes('acknowledged') ? 1 : 0,
    allowResolved: query.statuses?.includes('resolved') ? 1 : 0,
  }
}

function nullableFilters(
  query: ConflictRequest['query'],
  cursor: Exclude<ReturnType<typeof conflictCursor>, 'invalid'>,
) {
  return {
    projectPath: query.projectPath ?? null,
    workingPath: query.workingPath ?? null,
    parentSessionId: query.parentSessionId ?? null,
    workerSessionId: query.workerSessionId ?? null,
    delegationId: query.delegationId ?? null,
    cursorCreatedAt: cursor?.createdAt ?? null,
    cursorConflictId: cursor?.conflictId ?? null,
  }
}

export function listDelegationConflicts(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: ConflictRequest,
) {
  const cursor = conflictCursor(request)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const allowed = authorizedSessionScope(authority)
  const query = request.query
  const { selected: kindsSelected, kinds } = kindSelection(query)
  const {
    selected: statusesSelected,
    allowUnacknowledged,
    allowAcknowledged,
    allowResolved,
  } = statusSelection(query)
  const {
    projectPath,
    workingPath,
    parentSessionId,
    workerSessionId,
    delegationId,
    cursorCreatedAt,
    cursorConflictId,
  } = nullableFilters(query, cursor)
  return Effect.gen(function* () {
    const rows = yield* sql<ConflictCatalogRow>`
      SELECT conflicts.id, conflicts.left_delegation_id, conflicts.right_delegation_id,
        left_contract.child_session_id AS left_worker_session_id,
        right_contract.child_session_id AS right_worker_session_id,
        conflicts.kind, conflicts.evidence_json, conflicts.acknowledged_by,
        conflicts.acknowledgement_reason, conflicts.acknowledged_at,
        conflicts.resolved_at, conflicts.created_at
      FROM delegation_conflicts AS conflicts
      JOIN delegation_contracts AS left_contract ON left_contract.id = conflicts.left_delegation_id
      JOIN delegation_contracts AS right_contract ON right_contract.id = conflicts.right_delegation_id
      JOIN sessions AS left_worker ON left_worker.id = left_contract.child_session_id
      JOIN sessions AS right_worker ON right_worker.id = right_contract.child_session_id
      LEFT JOIN session_spawn_lineage AS left_lineage
        ON left_lineage.child_session_id = left_worker.id
      LEFT JOIN session_spawn_lineage AS right_lineage
        ON right_lineage.child_session_id = right_worker.id
      WHERE (${projectPath} IS NULL
          OR left_worker.project_path = ${projectPath}
          OR right_worker.project_path = ${projectPath})
        AND (${workingPath} IS NULL OR EXISTS (
          SELECT 1 FROM session_workspace_bindings AS binding
          JOIN workspace_resources AS workspace ON workspace.id = binding.workspace_id
          WHERE binding.session_id IN (left_worker.id, right_worker.id)
            AND workspace.working_path = ${workingPath}
        ))
        AND (${parentSessionId} IS NULL
          OR left_contract.parent_session_id = ${parentSessionId}
          OR right_contract.parent_session_id = ${parentSessionId})
        AND (${workerSessionId} IS NULL
          OR left_worker.id = ${workerSessionId}
          OR right_worker.id = ${workerSessionId})
        AND (${delegationId} IS NULL
          OR conflicts.left_delegation_id = ${delegationId}
          OR conflicts.right_delegation_id = ${delegationId})
        AND (${kindsSelected} = 0 OR conflicts.kind IN ${sql.in(kinds)})
        AND (${statusesSelected} = 0
          OR (${allowUnacknowledged} = 1
            AND conflicts.resolved_at IS NULL AND conflicts.acknowledged_by IS NULL)
          OR (${allowAcknowledged} = 1
            AND conflicts.resolved_at IS NULL AND conflicts.acknowledged_by IS NOT NULL)
          OR (${allowResolved} = 1 AND conflicts.resolved_at IS NOT NULL))
        AND (${cursorCreatedAt} IS NULL
          OR conflicts.created_at < ${cursorCreatedAt}
          OR (conflicts.created_at = ${cursorCreatedAt}
            AND conflicts.id < ${cursorConflictId}))
        AND (${allowed.all} = 1 OR (
          (left_worker.project_path IN ${sql.in(allowed.projectPaths)}
            OR left_worker.id IN ${sql.in(allowed.sessionIds)}
            OR COALESCE(left_lineage.hive_root_session_id, left_worker.id)
              IN ${sql.in(allowed.hiveRootSessionIds)})
          AND
          (right_worker.project_path IN ${sql.in(allowed.projectPaths)}
            OR right_worker.id IN ${sql.in(allowed.sessionIds)}
            OR COALESCE(right_lineage.hive_root_session_id, right_worker.id)
              IN ${sql.in(allowed.hiveRootSessionIds)})
        ))
      ORDER BY conflicts.created_at DESC, conflicts.id DESC
      LIMIT ${query.limit + 1}
    `
    return conflictListResponse(request, rows)
  })
}
