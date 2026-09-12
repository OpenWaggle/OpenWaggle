import {
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_BASELINE_MIGRATION_NAME,
  SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID,
  SESSION_HOST_DESKTOP_FENCE_MIGRATION_ID,
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_NAME,
  SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_ID,
  SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_NAME,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_NAME,
  SESSION_HOST_NODE_DELETE_MIGRATION_ID,
  SESSION_HOST_NODE_DELETE_MIGRATION_NAME,
  SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_ID,
  SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_NAME,
} from './session-host-schema-identity'

export const SESSION_HOST_ALPHA_BASELINE_ID = 26
export const SESSION_HOST_LEDGER_PAGE_SIZE = 16
const ALPHA_MIGRATION_OFFSET = 2
const RELEASED_WORKTREE_RECEIPT_ID = 27
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
const currentIdentities = [
  { id: SESSION_HOST_ALPHA_BASELINE_ID, name: 'session-worktree-setup-dispatch' },
  { id: RELEASED_WORKTREE_RECEIPT_ID, name: 'session-worktree-setup-receipt' },
  ...hiveIdentities,
  { id: SESSION_HOST_DESKTOP_FENCE_MIGRATION_ID, name: 'session-host-desktop-mutation-fences' },
  {
    id: SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID,
    name: 'session-host-browser-preview-attachments',
  },
]

export interface MigrationIdentity {
  readonly id: number
  readonly name: string
}

/** Only the exact, pre-release Hive identity set may move; released IDs never move. */
export function planSessionHostLedgerUpgrade(rows: readonly MigrationIdentity[]) {
  const alpha = rows.some(
    (row) =>
      row.id === SESSION_HOST_ALPHA_BASELINE_ID &&
      row.name === SESSION_HOST_BASELINE_MIGRATION_NAME,
  )
  const known = alpha
    ? hiveIdentities.map((row) => ({ ...row, id: row.id - ALPHA_MIGRATION_OFFSET }))
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
  return alpha
    ? relevant
        .map((row) => ({ ...row, targetId: row.id + ALPHA_MIGRATION_OFFSET }))
        .sort((left, right) => right.id - left.id)
    : []
}
