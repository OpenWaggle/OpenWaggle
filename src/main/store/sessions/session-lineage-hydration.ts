import { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { DelegationState } from '@shared/types/session-collaboration'

export interface SessionLineageRow {
  readonly session_id: string
  readonly parent_session_id: string | null
  readonly parent_title: string | null
  readonly hive_root_session_id: string | null
  readonly direct_worker_count: number
  readonly active_direct_worker_count: number
  readonly profile_json: string | null
  readonly legacy_agent_definition_name: string | null
  readonly delegation_id: string | null
  readonly delegation_state: DelegationState | null
  readonly source_session_id: string | null
  readonly source_title: string | null
  readonly source_node_id: string | null
  readonly derivation_position: 'before' | 'at' | null
}

function profileAgentDefinitionName(profileJson: string | null) {
  if (!profileJson) return undefined
  try {
    const parsed: unknown = JSON.parse(profileJson)
    return typeof parsed === 'object' &&
      parsed !== null &&
      'agentDefinitionName' in parsed &&
      typeof parsed.agentDefinitionName === 'string'
      ? parsed.agentDefinitionName
      : undefined
  } catch {
    return undefined
  }
}

function agentDefinitionName(row: SessionLineageRow) {
  return (
    profileAgentDefinitionName(row.profile_json) ?? row.legacy_agent_definition_name ?? undefined
  )
}

export function attachSessionLineage(
  sessions: readonly SessionSummary[],
  rows: readonly SessionLineageRow[],
) {
  const bySessionId = new Map(rows.map((row) => [row.session_id, row]))
  return sessions.map((session) => {
    const row = bySessionId.get(String(session.id))
    if (!row) return session
    const definitionName = agentDefinitionName(row)
    const role: 'worker' | 'queen' | 'independent' = row.parent_session_id
      ? 'worker'
      : row.direct_worker_count > 0
        ? 'queen'
        : 'independent'
    return {
      ...session,
      ...(row.source_session_id && row.source_node_id && row.derivation_position
        ? {
            derivation: {
              sourceSessionId: SessionId(row.source_session_id),
              ...(row.source_title ? { sourceTitle: row.source_title } : {}),
              sourceNodeId: SessionNodeId(row.source_node_id),
              position: row.derivation_position,
            },
          }
        : {}),
      lineage: {
        role,
        ...(row.parent_session_id ? { parentSessionId: SessionId(row.parent_session_id) } : {}),
        ...(row.parent_title ? { parentTitle: row.parent_title } : {}),
        ...(row.hive_root_session_id
          ? { hiveRootSessionId: SessionId(row.hive_root_session_id) }
          : {}),
        directWorkerCount: row.direct_worker_count,
        activeDirectWorkerCount: row.active_direct_worker_count,
        ...(definitionName ? { agentDefinitionName: definitionName } : {}),
        ...(row.delegation_id ? { delegationId: row.delegation_id } : {}),
        ...(row.delegation_state ? { delegationState: row.delegation_state } : {}),
      },
    }
  })
}
