import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type { SessionNode } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'

export interface SessionRow {
  readonly id: string
  readonly pi_session_id: string
  readonly pi_session_file: string | null
  readonly project_path: string | null
  readonly title: string
  /** Read where a caller needs the title's provenance, such as the Run preflight. */
  readonly title_source?: string | null
  readonly archived: number
  readonly waggle_config_json: string | null
  readonly created_at: number
  readonly updated_at: number
  readonly last_active_node_id: string | null
  readonly last_active_branch_id: string | null
  readonly environment_mode: string | null
  readonly worktree_path: string | null
  readonly worktree_base_ref: string | null
  readonly worktree_start_from_origin: number | null
  readonly authorization_mode_override: string | null
  readonly execution_model_id: string | null
  readonly execution_thinking_level: string | null
  /** 1 when the Session uses a discovered Pi session file (ADR 0051). */
  readonly pi_adopted?: number
  /** The working directory a discovered Pi session ran in (ADR 0051). */
  readonly pi_cwd?: string | null
}

export interface SessionSummaryRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly created_at: number
  readonly updated_at: number
  readonly message_count: number
}

export interface SessionBranchRow {
  readonly id: string
  readonly session_id: string
  readonly source_node_id: string | null
  readonly head_node_id: string | null
  readonly name: string
  readonly is_main: number
  readonly archived_at: number | null
  readonly created_at: number
  readonly updated_at: number
}

export interface SessionBranchStateRow {
  readonly branch_id: string
  readonly future_mode: 'standard' | 'waggle'
  readonly waggle_preset_id: string | null
  readonly waggle_config_json: string | null
  readonly last_active_at: number
  readonly ui_state_json: string
}

export interface SessionActiveRunRow {
  readonly run_id: string
  readonly session_id: string
  readonly branch_id: string
  readonly run_mode: string
  readonly status: string
  readonly runtime_json: string
  readonly updated_at: number
}

export interface SessionNodeRow {
  readonly id: string
  readonly session_id: string
  readonly parent_id: string | null
  readonly pi_entry_type: string
  readonly kind: SessionNode['kind']
  readonly role: 'user' | 'assistant' | 'system' | null
  readonly timestamp_ms: number
  readonly content_json: string
  readonly metadata_json: string
  readonly branch_hint_id: string | null
  readonly path_depth: number
  readonly created_order: number
}

/** A node row as snapshot persistence first reads it: every column but the content (D6). */
export type SessionNodeShapeRow = Omit<SessionNodeRow, 'content_json' | 'metadata_json'> & {
  /** `sessionNodeContentHash` of the stored content and metadata, or null when unknown. */
  readonly content_hash: string | null
}

/**
 * A node row as snapshot persistence compares it with the snapshot. `content` is the stored
 * content and metadata when they may differ from the snapshot node's; null when the stored digest
 * equals the snapshot node's, so both are known to be unchanged without reading them.
 */
export type ComparedSessionNodeRow = SessionNodeShapeRow & {
  readonly content: Pick<SessionNodeRow, 'content_json' | 'metadata_json'> | null
}

export interface UpdateSessionRuntimeInput {
  readonly sessionId: SessionId
  readonly piSessionId?: string
  readonly piSessionFile?: string
}

export interface CreateSessionInput {
  readonly projectPath: string
  readonly piSessionId: string
  readonly piSessionFile?: string
  /** Environment mode the session is born with (defaults to 'local' when omitted). */
  readonly environmentMode?: SessionEnvironmentMode
  /** Authorization mode the session is born with (defaults to YOLO when omitted). */
  readonly authorizationMode?: AgentAuthorizationMode
  /** The Session a fork or clone copies; it keeps that Session's MCP off when it was off. */
  readonly copyMcpSwitchFrom?: SessionId
}

export interface DerivedSessionBranch {
  readonly id: string
  readonly sourceNodeId: string | null
  readonly headNodeId: string | null
  readonly name: string
  readonly isMain: boolean
  readonly archivedAt: number | null
  readonly createdAt: number
}

export interface BranchStateValue {
  readonly futureMode: 'standard' | 'waggle'
  readonly wagglePresetId: string | null
  readonly waggleConfigJson: string | null
  readonly lastActiveAt: number
  readonly uiStateJson: string
}

export interface BranchModeStateValue {
  readonly enabled: boolean
  readonly presetId?: string
  readonly config?: WaggleConfig
}

export interface BranchStateValueInput {
  readonly branch: DerivedSessionBranch
  readonly activeBranchId: string
  readonly modeState: BranchModeStateValue | null
  readonly waggleConfig: WaggleConfig | undefined
  readonly existingState: SessionBranchStateRow | undefined
  readonly now: number
}
