import type { SessionDelegationState, SessionHiveRole } from '@shared/types/session'

export interface SessionSummaryRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly created_at: number
  readonly updated_at: number
  readonly last_active_node_id: string | null
  readonly last_active_branch_id: string | null
  /** Resolves each session's working path, for per-session git state in lists. */
  readonly environment_mode: string | null
  readonly worktree_path: string | null
  readonly lineage_present: number
  readonly lineage_role: SessionHiveRole
  readonly parent_session_id: string | null
  readonly direct_worker_count: number
  readonly active_direct_worker_count: number
  readonly agent_definition_name: string | null
  readonly delegation_state: SessionDelegationState | null
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

/**
 * The columns a {@link SessionSummaryRow} needs, as one list.
 *
 * A SELECT column list is invisible to the type checker: `sql<SessionSummaryRow>` asserts
 * the row shape, it does not verify that the query actually selects those columns. Three
 * queries typed this way once omitted `environment_mode` and `worktree_path`, so every
 * session in the list silently reported local mode and no worktree — the per-session git
 * indicators were simply absent, and nothing failed.
 *
 * Interpolate this rather than spelling the columns out, so a query cannot select a subset
 * of what its own type promises. `SESSION_SUMMARY_COLUMN_NAMES` is exported for the test
 * that pins the two together.
 */
export const SESSION_SUMMARY_COLUMN_NAMES: readonly string[] = [
  'id',
  'title',
  'project_path',
  'archived',
  'created_at',
  'updated_at',
  'last_active_node_id',
  'last_active_branch_id',
  'environment_mode',
  'worktree_path',
  'lineage_present',
  'lineage_role',
  'parent_session_id',
  'direct_worker_count',
  'active_direct_worker_count',
  'agent_definition_name',
  'delegation_state',
]
