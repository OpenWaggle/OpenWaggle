export interface SessionSummaryRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly created_at: number
  readonly updated_at: number
  readonly last_active_node_id: string | null
  readonly last_active_branch_id: string | null
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
  readonly waggle_config_json: string | null
  readonly last_active_at: number
  readonly ui_state_json: string
}

export interface SessionTreeUiStateRow {
  readonly session_id: string
  readonly expanded_node_ids_json: string
  readonly expanded_node_ids_touched: number
  readonly branches_sidebar_collapsed: number
  readonly updated_at: number
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
