import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { DelegationState } from '@shared/types/session-collaboration'
import type {
  SessionQueryOutcome,
  SessionQueryRequest,
  SessionQueryResponse,
  SessionQuerySummary,
} from '@shared/types/session-query'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'

const NO_AUTHORIZED_PROJECT = '__no_authorized_project__'
const NO_AUTHORIZED_SESSION = '__no_authorized_session__'
const NO_AUTHORIZED_HIVE = '__no_authorized_hive__'

export interface SessionQuerySummaryRow {
  readonly session_id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly created_at: number
  readonly updated_at: number
  readonly parent_session_id: string | null
  readonly hive_root_session_id: string | null
  readonly direct_worker_count: number
  readonly profile_json: string | null
  readonly delegation_id: string | null
  readonly delegation_state: DelegationState | null
}

export function sessionQueryResponse(
  request: SessionQueryRequest,
  outcome: SessionQueryOutcome,
): SessionQueryResponse {
  return { contractVersion: SESSION_QUERY_CONTRACT_VERSION, requestId: request.requestId, outcome }
}

export function parseSessionJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value)
  return parsed
}

function agentDefinitionName(profileJson: string | null) {
  if (!profileJson) return undefined
  try {
    const profile = parseSessionJson(profileJson)
    if (typeof profile !== 'object' || profile === null || !('agentDefinitionName' in profile)) {
      return undefined
    }
    return typeof profile.agentDefinitionName === 'string' ? profile.agentDefinitionName : undefined
  } catch {
    return undefined
  }
}

export function sessionQuerySummary(row: SessionQuerySummaryRow): SessionQuerySummary {
  const worker = row.parent_session_id !== null
  const queen = !worker && row.direct_worker_count > 0
  const definitionName = agentDefinitionName(row.profile_json)
  return {
    sessionId: row.session_id,
    title: row.title,
    projectPath: row.project_path,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lineageRole: worker ? 'worker' : queen ? 'queen' : 'independent',
    ...(row.parent_session_id ? { parentSessionId: row.parent_session_id } : {}),
    ...(row.hive_root_session_id ? { hiveRootSessionId: row.hive_root_session_id } : {}),
    directWorkerCount: row.direct_worker_count,
    ...(definitionName ? { agentDefinitionName: definitionName } : {}),
    ...(row.delegation_id ? { delegationId: row.delegation_id } : {}),
    ...(isDelegationState(row.delegation_state) ? { delegationState: row.delegation_state } : {}),
  }
}

function isDelegationState(
  value: string | null,
): value is NonNullable<SessionQuerySummary['delegationState']> {
  return (
    value === 'working' ||
    value === 'waiting' ||
    value === 'needs_attention' ||
    value === 'ready_for_review' ||
    value === 'revision_requested' ||
    value === 'accepted' ||
    value === 'cancelled'
  )
}

export function authorizedSessionScope(authority: LocalSessionProfileAuthority | undefined) {
  return {
    all: authority === undefined || authority.scope.all === true ? 1 : 0,
    projectPaths: authority?.scope.projectPaths?.length
      ? [...authority.scope.projectPaths]
      : [NO_AUTHORIZED_PROJECT],
    sessionIds: authority?.scope.sessionIds?.length
      ? [...authority.scope.sessionIds]
      : [NO_AUTHORIZED_SESSION],
    hiveRootSessionIds: authority?.scope.hiveRootSessionIds?.length
      ? [...authority.scope.hiveRootSessionIds]
      : [NO_AUTHORIZED_HIVE],
  }
}

export function decodeSessionQueryCursor(
  cursor: string | undefined,
): Record<string, unknown> | null | 'invalid' {
  if (!cursor) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : 'invalid'
  } catch {
    return 'invalid'
  }
}

export function encodeSessionQueryCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function invalidSessionQueryCursor(request: SessionQueryRequest) {
  return sessionQueryResponse(request, {
    operation: request.query.operation,
    error: { code: 'invalid_cursor', message: 'The Session query cursor is invalid.' },
  })
}
