import { Schema } from '@shared/schema'
import { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { DelegationState } from '@shared/types/session-collaboration'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { decodeAttentionCause } from '../../adapters/sqlite-hive-next-actor-facts'

export interface SessionLineageRow {
  readonly session_id: string
  readonly parent_session_id: string | null
  readonly parent_title: string | null
  readonly hive_root_session_id: string | null
  readonly direct_worker_count: number
  readonly active_direct_worker_count: number
  /** Workers below the Session, at any depth, with a live Run (ADR 0065). */
  readonly running_worker_count: number
  /** When the last settled Run below the Session ended; null when none has. */
  readonly workers_last_run_ended_at: number | null
  readonly profile_json: string | null
  readonly legacy_agent_definition_name: string | null
  readonly historical_lineage: number
  readonly delegation_id: string | null
  readonly delegation_state: DelegationState | null
  readonly attention_cause: string | null
  /** 1 or 0 for a Host Delegation; null for retired task-runner lineage. */
  readonly parent_will_act: number | null
  readonly source_session_id: string | null
  readonly source_title: string | null
  readonly source_node_id: string | null
  readonly derivation_position: 'before' | 'at' | null
}

/** What a Session's execution profile says about the Agent definition it was created from. */
interface ProfileAgentFacts {
  readonly agentDefinitionName?: string
  readonly modelId?: string
  readonly thinkingLevel?: ThinkingLevel
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value)
}

/** The execution profile members these facts read, each still unchecked. */
const profileAgentFieldsSchema = Schema.Struct({
  agentDefinitionName: Schema.optionalWith(Schema.Unknown, { exact: true }),
  modelId: Schema.optionalWith(Schema.Unknown, { exact: true }),
  thinkingLevel: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

function profileAgentFacts(profileJson: string | null) {
  if (!profileJson) {
    const facts: ProfileAgentFacts = {}
    return facts
  }
  try {
    const parsed: unknown = JSON.parse(profileJson)
    if (!Schema.is(profileAgentFieldsSchema)(parsed)) {
      const facts: ProfileAgentFacts = {}
      return facts
    }
    const { agentDefinitionName: name, modelId, thinkingLevel } = parsed
    const facts: ProfileAgentFacts = {
      ...(typeof name === 'string' ? { agentDefinitionName: name } : {}),
      ...(typeof modelId === 'string' && modelId ? { modelId } : {}),
      ...(isThinkingLevel(thinkingLevel) ? { thinkingLevel } : {}),
    }
    return facts
  } catch {
    const facts: ProfileAgentFacts = {}
    return facts
  }
}

/** What the next-actor rule needs from the Host (ADR 0059); live parts are added by the caller. */
function nextActorFacts(row: SessionLineageRow) {
  const attentionCause = decodeAttentionCause(row.attention_cause)
  return {
    ...(attentionCause ? { attentionCause } : {}),
    ...(row.parent_will_act === null ? {} : { parentWillAct: row.parent_will_act === 1 }),
  }
}

/**
 * The Agent definition a Session runs, with the model and thinking level its execution profile
 * holds now, which the model picker and a Run's thinking level may have changed since creation
 * (the Hive panel's identity line); a Session not created from a definition has none of them.
 */
function agentDefinitionLineage(row: SessionLineageRow) {
  const profile = profileAgentFacts(row.profile_json)
  const name = profile.agentDefinitionName ?? row.legacy_agent_definition_name ?? undefined
  if (!name) return {}
  return {
    agentDefinitionName: name,
    ...(profile.modelId ? { agentModelId: profile.modelId } : {}),
    ...(profile.thinkingLevel ? { agentThinkingLevel: profile.thinkingLevel } : {}),
  }
}

/** A parent's Running Workers and Done-below time (ADR 0065); nothing for a Session without any. */
function workerRunLineage(row: SessionLineageRow) {
  if (row.running_worker_count === 0 && row.workers_last_run_ended_at === null) return {}
  return {
    runningWorkerCount: row.running_worker_count,
    ...(row.workers_last_run_ended_at === null
      ? {}
      : { workersLastRunEndedAt: row.workers_last_run_ended_at }),
  }
}

export function attachSessionLineage(
  sessions: readonly SessionSummary[],
  rows: readonly SessionLineageRow[],
) {
  const bySessionId = new Map(rows.map((row) => [row.session_id, row]))
  return sessions.map((session) => {
    const row = bySessionId.get(String(session.id))
    if (!row) return session
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
        ...workerRunLineage(row),
        ...agentDefinitionLineage(row),
        ...(row.delegation_id ? { delegationId: row.delegation_id } : {}),
        ...(row.delegation_state ? { delegationState: row.delegation_state } : {}),
        ...nextActorFacts(row),
        ...(row.historical_lineage ? { historical: true } : {}),
      },
    }
  })
}
