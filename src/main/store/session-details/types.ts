import { type SchemaType, Schema } from '@shared/schema'
import { SESSION_NODE_KINDS } from '@shared/types/session-node'
import { sqliteIntegerSchema } from '../../adapters/sqlite-row-schema'
import { sessionBranchStateRowSchema } from '../sessions/types'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type { WaggleConfig } from '@shared/types/waggle'

export type { SessionActiveRunRow, SessionBranchRow } from '../sessions/types'

const nullableStringSchema = Schema.NullOr(Schema.String)

export const sessionRowSchema = Schema.Struct({
  id: Schema.String,
  pi_session_id: Schema.String,
  pi_session_file: nullableStringSchema,
  project_path: nullableStringSchema,
  title: Schema.String,
  /** Read where a caller needs the title's provenance, such as the Run preflight. */
  title_source: Schema.optional(nullableStringSchema),
  archived: sqliteIntegerSchema,
  waggle_config_json: nullableStringSchema,
  created_at: sqliteIntegerSchema,
  updated_at: sqliteIntegerSchema,
  last_active_node_id: nullableStringSchema,
  last_active_branch_id: nullableStringSchema,
  environment_mode: nullableStringSchema,
  worktree_path: nullableStringSchema,
  worktree_base_ref: nullableStringSchema,
  worktree_start_from_origin: Schema.NullOr(sqliteIntegerSchema),
  authorization_mode_override: nullableStringSchema,
  execution_model_id: nullableStringSchema,
  execution_thinking_level: nullableStringSchema,
  /** 1 when the Session uses a discovered Pi session file (ADR 0051). */
  pi_adopted: Schema.optional(sqliteIntegerSchema),
  /** The working directory a discovered Pi session ran in (ADR 0051). */
  pi_cwd: Schema.optional(nullableStringSchema),
})
export type SessionRow = SchemaType<typeof sessionRowSchema>

export const sessionSummaryRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  project_path: nullableStringSchema,
  archived: sqliteIntegerSchema,
  created_at: sqliteIntegerSchema,
  updated_at: sqliteIntegerSchema,
  message_count: sqliteIntegerSchema,
})
export type SessionSummaryRow = SchemaType<typeof sessionSummaryRowSchema>

/** A branch's state as snapshot persistence reads it, with the Waggle preset it last used. */
export const sessionBranchStateDetailRowSchema = Schema.Struct({
  ...sessionBranchStateRowSchema.fields,
  waggle_preset_id: nullableStringSchema,
})
export type SessionBranchStateRow = SchemaType<typeof sessionBranchStateDetailRowSchema>

const sessionNodeShapeFields = {
  id: Schema.String,
  session_id: Schema.String,
  parent_id: nullableStringSchema,
  pi_entry_type: Schema.String,
  kind: Schema.Literal(...SESSION_NODE_KINDS),
  role: Schema.NullOr(Schema.Literal('user', 'assistant', 'system')),
  timestamp_ms: Schema.Number,
  branch_hint_id: nullableStringSchema,
  path_depth: sqliteIntegerSchema,
  created_order: sqliteIntegerSchema,
}

export const sessionNodeRowSchema = Schema.Struct({
  ...sessionNodeShapeFields,
  content_json: Schema.String,
  metadata_json: Schema.String,
})
export type SessionNodeRow = SchemaType<typeof sessionNodeRowSchema>

/** A node row as snapshot persistence first reads it: every column but the content (D6). */
export const sessionNodeShapeRowSchema = Schema.Struct({
  ...sessionNodeShapeFields,
  /** `sessionNodeContentHash` of the stored content and metadata, or null when unknown. */
  content_hash: nullableStringSchema,
})
export type SessionNodeShapeRow = SchemaType<typeof sessionNodeShapeRowSchema>

/** A node's stored content, read in batches only where it may differ from the snapshot's. */
export const sessionNodeContentRowSchema = Schema.Struct({
  id: Schema.String,
  content_json: Schema.String,
  metadata_json: Schema.String,
})

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
