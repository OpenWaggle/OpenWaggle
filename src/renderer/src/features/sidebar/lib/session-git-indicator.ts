import type { GitStatusSummary } from '@shared/types/git'

/** What a session's row shows about its working tree at a glance. */
export interface SessionGitIndicator {
  /** Uncommitted changes exist in this session's working tree. */
  readonly isDirty: boolean
  readonly changedFileCount: number
  readonly ahead: number
  readonly behind: number
  /** Short text for the row, empty when there is nothing worth showing. */
  readonly label: string
  /** Full description for assistive technology and the row tooltip. */
  readonly description: string
}

const EMPTY_INDICATOR: SessionGitIndicator = {
  isDirty: false,
  changedFileCount: 0,
  ahead: 0,
  behind: 0,
  label: '',
  description: '',
}

/**
 * Summarise one session's working tree for its row in a session list.
 *
 * Deliberately returns an empty indicator rather than a placeholder when status is
 * unknown: a session whose status has not been fetched must not look clean, because
 * "no badge" and "confirmed clean" would otherwise be indistinguishable.
 */
export function buildSessionGitIndicator(
  status: GitStatusSummary | null | undefined,
): SessionGitIndicator {
  if (!status) return EMPTY_INDICATOR

  const changedFileCount = status.filesChanged
  const isDirty = !status.clean && changedFileCount > 0
  const ahead = Math.max(0, status.ahead)
  const behind = Math.max(0, status.behind)

  const parts: string[] = []
  if (isDirty) parts.push(`${String(changedFileCount)}\u00b7`)
  if (ahead > 0) parts.push(`\u2191${String(ahead)}`)
  if (behind > 0) parts.push(`\u2193${String(behind)}`)

  if (parts.length === 0) return { ...EMPTY_INDICATOR, ahead, behind }

  return {
    isDirty,
    changedFileCount,
    ahead,
    behind,
    label: parts.join(' '),
    description: buildDescription({ isDirty, changedFileCount, ahead, behind }),
  }
}

function buildDescription(input: {
  isDirty: boolean
  changedFileCount: number
  ahead: number
  behind: number
}) {
  const clauses: string[] = []
  if (input.isDirty) {
    const plural = input.changedFileCount === 1 ? 'file' : 'files'
    clauses.push(`${String(input.changedFileCount)} changed ${plural}`)
  }
  if (input.ahead > 0) clauses.push(`${String(input.ahead)} ahead`)
  if (input.behind > 0) clauses.push(`${String(input.behind)} behind`)
  return clauses.join(', ')
}
