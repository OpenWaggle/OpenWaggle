import { type SchemaType, Schema } from '@shared/schema'
import { sqliteIntegerSchema } from '../../adapters/sqlite-row-schema'

const nullableStringSchema = Schema.NullOr(Schema.String)
const nullableIntegerSchema = Schema.NullOr(sqliteIntegerSchema)

export const sessionSummaryRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  project_path: nullableStringSchema,
  archived: sqliteIntegerSchema,
  created_at: sqliteIntegerSchema,
  updated_at: sqliteIntegerSchema,
  last_active_node_id: nullableStringSchema,
  last_active_branch_id: nullableStringSchema,
  /** Resolves each session's working path, for per-session git state in lists. */
  environment_mode: nullableStringSchema,
  worktree_path: nullableStringSchema,
})
export type SessionSummaryRow = SchemaType<typeof sessionSummaryRowSchema>

export const sessionBranchRowSchema = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  source_node_id: nullableStringSchema,
  head_node_id: nullableStringSchema,
  name: Schema.String,
  is_main: sqliteIntegerSchema,
  archived_at: nullableIntegerSchema,
  created_at: sqliteIntegerSchema,
  updated_at: sqliteIntegerSchema,
})
export type SessionBranchRow = SchemaType<typeof sessionBranchRowSchema>

export const sessionBranchStateRowSchema = Schema.Struct({
  branch_id: Schema.String,
  future_mode: Schema.Literal('standard', 'waggle'),
  waggle_config_json: nullableStringSchema,
  last_active_at: sqliteIntegerSchema,
  ui_state_json: Schema.String,
})
export type SessionBranchStateRow = SchemaType<typeof sessionBranchStateRowSchema>

export const sessionTreeUiStateRowSchema = Schema.Struct({
  session_id: Schema.String,
  expanded_node_ids_json: Schema.String,
  expanded_node_ids_touched: sqliteIntegerSchema,
  branches_sidebar_collapsed: sqliteIntegerSchema,
  last_visited_at: nullableIntegerSchema,
  updated_at: sqliteIntegerSchema,
})
export type SessionTreeUiStateRow = SchemaType<typeof sessionTreeUiStateRowSchema>

export const sessionLatestRunRowSchema = Schema.Struct({
  session_id: Schema.String,
  status: Schema.Literal(
    'starting',
    'active',
    'stopping',
    'completed',
    'failed',
    'interrupted',
    'interrupted-by-host-loss',
    'interrupted-by-interaction-timeout',
  ),
  updated_at: sqliteIntegerSchema,
})
export type SessionLatestRunRow = SchemaType<typeof sessionLatestRunRowSchema>

export const sessionActiveRunRowSchema = Schema.Struct({
  run_id: Schema.String,
  session_id: Schema.String,
  branch_id: Schema.String,
  run_mode: Schema.String,
  status: Schema.String,
  runtime_json: Schema.String,
  updated_at: sqliteIntegerSchema,
})
export type SessionActiveRunRow = SchemaType<typeof sessionActiveRunRowSchema>

/**
 * The columns a {@link SessionSummaryRow} needs, as one list.
 *
 * A SELECT column list is invisible to the type checker. Three queries once omitted
 * `environment_mode` and `worktree_path`, so every session in the list silently reported local
 * mode and no worktree. The row schema now fails such a query, and interpolating this list,
 * which is the schema's own fields, keeps a query from selecting a subset in the first place.
 */
export const SESSION_SUMMARY_COLUMN_NAMES: readonly string[] = Object.keys(
  sessionSummaryRowSchema.fields,
)
