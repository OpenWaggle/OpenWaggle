import {
  SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION,
  SESSION_RESOURCE_MIGRATIONS,
} from './database-session-resource-migrations'
import {
  DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
  HIVE_TOOL_NAME_MIGRATION_ID,
  PI_SESSION_ADOPTION_MIGRATION_ID,
  PI_SESSION_DISCOVERY_CREATE_MIGRATION_ID,
  PI_SESSION_FILE_STATE_MIGRATION_ID,
  SCHEDULED_TASK_MIGRATION_ID,
  SESSION_ARCHIVE_TIME_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_NAME,
  SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID,
  SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION_ID,
  SESSION_HOST_DESKTOP_FENCE_MIGRATION_ID,
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_NAME,
  SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_ID,
  SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_NAME,
  SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_ID,
  SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_NAME,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_NAME,
  SESSION_HOST_NODE_DELETE_MIGRATION_ID,
  SESSION_HOST_NODE_DELETE_MIGRATION_NAME,
  SESSION_HOST_PROJECT_ACTION_MIGRATION_ID,
  SESSION_HOST_PROJECT_ACTION_RUN_POLLING_MIGRATION_ID,
  SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID,
  SESSION_HOST_QUEUE_PAUSE_REASON_MIGRATION_ID,
  SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_ID,
  SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_NAME,
  SESSION_HOST_TURN_CHECKPOINT_STARTED_AT_MIGRATION_ID,
  SESSION_MCP_SWITCH_MIGRATION_ID,
  SESSION_NODE_DUPLICATE_INDEX_MIGRATION_ID,
  SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID,
  SESSION_TITLE_PROVENANCE_MIGRATION_ID,
} from './session-host-schema-identity'

export const SESSION_HOST_ALPHA_BASELINE_ID = 26
export const SESSION_HOST_LEDGER_PAGE_SIZE = 64
const ALPHA_MIGRATION_OFFSET = 23
const PRE_SUMMARY_HOST_MIGRATION_OFFSET = 21
const RELEASED_WORKTREE_RECEIPT_ID = 27
const RELEASED_SESSION_SUMMARY_BASELINE_ID = 28
const hiveIdentities = [
  { id: SESSION_HOST_BASELINE_MIGRATION_ID, name: SESSION_HOST_BASELINE_MIGRATION_NAME },
  {
    id: SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID,
    name: SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_NAME,
  },
  {
    id: SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_ID,
    name: SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_NAME,
  },
  {
    id: SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_ID,
    name: SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_NAME,
  },
  { id: SESSION_HOST_NODE_DELETE_MIGRATION_ID, name: SESSION_HOST_NODE_DELETE_MIGRATION_NAME },
  {
    id: SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
    name: SESSION_HOST_DISCOVERY_TERM_MIGRATION_NAME,
  },
]
const releasedIdentities = [
  { id: SESSION_HOST_ALPHA_BASELINE_ID, name: 'session-worktree-setup-dispatch' },
  { id: RELEASED_WORKTREE_RECEIPT_ID, name: 'session-worktree-setup-receipt' },
  { id: RELEASED_SESSION_SUMMARY_BASELINE_ID, name: 'session-hive-lineage' },
  ...SESSION_RESOURCE_MIGRATIONS.map(({ id, name }) => ({ id, name })),
]
const currentIdentities = [
  ...releasedIdentities,
  ...hiveIdentities,
  { id: SESSION_HOST_DESKTOP_FENCE_MIGRATION_ID, name: 'session-host-desktop-mutation-fences' },
  {
    id: SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID,
    name: 'session-host-browser-preview-attachments',
  },
  {
    id: SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID,
    name: 'session-host-project-catalog-generation',
  },
  {
    id: SESSION_HOST_TURN_CHECKPOINT_STARTED_AT_MIGRATION_ID,
    name: 'turn-checkpoint-started-at',
  },
  {
    id: SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION.id,
    name: SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION.name,
  },
  { id: SESSION_HOST_PROJECT_ACTION_MIGRATION_ID, name: 'native-project-actions' },
  {
    id: SESSION_HOST_PROJECT_ACTION_RUN_POLLING_MIGRATION_ID,
    name: 'project-action-run-polling-indexes',
  },
  { id: SESSION_HOST_QUEUE_PAUSE_REASON_MIGRATION_ID, name: 'session-host-queue-pause-reason' },
  { id: SESSION_TITLE_PROVENANCE_MIGRATION_ID, name: 'session-title-provenance' },
  {
    id: SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_ID,
    name: SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_NAME,
  },
  { id: PI_SESSION_ADOPTION_MIGRATION_ID, name: 'pi-session-adoption' },
  { id: PI_SESSION_FILE_STATE_MIGRATION_ID, name: 'pi-session-file-state' },
  { id: SESSION_MCP_SWITCH_MIGRATION_ID, name: 'session-mcp-switch' },
  { id: PI_SESSION_DISCOVERY_CREATE_MIGRATION_ID, name: 'pi-session-discovery-creates' },
  { id: SESSION_ARCHIVE_TIME_MIGRATION_ID, name: 'session-archive-time' },
  { id: SCHEDULED_TASK_MIGRATION_ID, name: 'scheduled-tasks' },
  { id: HIVE_TOOL_NAME_MIGRATION_ID, name: 'hive-tool-name' },
  {
    id: SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION_ID,
    name: 'session-host-deferred-discovery-refresh',
  },
  {
    id: SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID,
    name: 'session-resource-docs-image-references',
  },
  { id: DELEGATION_ATTENTION_CAUSE_MIGRATION_ID, name: 'delegation-attention-cause' },
  { id: SESSION_NODE_DUPLICATE_INDEX_MIGRATION_ID, name: 'session-node-duplicate-index' },
]

export interface MigrationIdentity {
  readonly id: number
  readonly name: string
}

/** Move only known pre-release Host identities; keep released Setup and Summary IDs unchanged. */
export function planSessionHostLedgerUpgrade(rows: readonly MigrationIdentity[]) {
  const alpha = rows.some(
    (row) =>
      row.id === SESSION_HOST_ALPHA_BASELINE_ID &&
      row.name === SESSION_HOST_BASELINE_MIGRATION_NAME,
  )
  const preSummary = rows.some(
    (row) =>
      row.id === RELEASED_SESSION_SUMMARY_BASELINE_ID &&
      row.name === SESSION_HOST_BASELINE_MIGRATION_NAME,
  )
  const preSummaryIdentities = currentIdentities
    .filter(
      (row) =>
        row.id >= SESSION_HOST_BASELINE_MIGRATION_ID &&
        row.id <= SESSION_HOST_TURN_CHECKPOINT_STARTED_AT_MIGRATION_ID,
    )
    .map((row) => ({ ...row, id: row.id - PRE_SUMMARY_HOST_MIGRATION_OFFSET }))
  const known = alpha
    ? hiveIdentities.map((row) => ({ ...row, id: row.id - ALPHA_MIGRATION_OFFSET }))
    : preSummary
      ? [
          ...releasedIdentities.filter((row) => row.id <= RELEASED_WORKTREE_RECEIPT_ID),
          ...preSummaryIdentities,
        ]
      : currentIdentities
  const relevant = rows.filter((row) => row.id >= SESSION_HOST_ALPHA_BASELINE_ID)
  if (
    relevant.length > known.length ||
    relevant.some(
      (row) => !known.some((expected) => expected.id === row.id && expected.name === row.name),
    )
  ) {
    throw new Error('Session Host migration ledger contains incompatible or mixed identities.')
  }
  const offset = alpha ? ALPHA_MIGRATION_OFFSET : preSummary ? PRE_SUMMARY_HOST_MIGRATION_OFFSET : 0
  return offset === 0
    ? []
    : relevant
        .filter((row) => alpha || row.id >= RELEASED_SESSION_SUMMARY_BASELINE_ID)
        .map((row) => ({ ...row, targetId: row.id + offset }))
        .sort((left, right) => right.id - left.id)
}
