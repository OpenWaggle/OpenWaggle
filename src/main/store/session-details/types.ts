import type { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'

export interface SessionRow {
  readonly id: string
  readonly pi_session_id: string
  readonly pi_session_file: string | null
  readonly project_path: string | null
  readonly title: string
  readonly archived: number
  readonly waggle_config_json: string | null
  readonly created_at: number
  readonly updated_at: number
  readonly last_active_node_id: string | null
  readonly last_active_branch_id: string | null
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

export interface StagedSessionFileDeletion {
  readonly cleanup: () => Promise<void>
  readonly restore: () => Promise<void>
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

export interface UpdateSessionRuntimeInput {
  readonly sessionId: SessionId
  readonly piSessionId?: string
  readonly piSessionFile?: string
}

export interface CreateSessionInput {
  readonly projectPath: string
  readonly piSessionId: string
  readonly piSessionFile?: string
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
