import type { GitStatusSummary } from '@shared/types/git'

/**
 * What a session's row shows about its working tree at a glance.
 *
 * Ahead and behind only. The uncommitted changed-file count was removed deliberately:
 * every session sharing a working tree reported the same number, so the count told the
 * user nothing about the session they were looking at, and a large number implied
 * severity it did not have. Recorded in the git integration documentation.
 */
export interface SessionGitIndicator {
  readonly ahead: number
  readonly behind: number
  /** Short text for the row, empty when there is nothing worth showing. */
  readonly label: string
  /** Full description for assistive technology and the row tooltip. */
  readonly description: string
}

const EMPTY_INDICATOR: SessionGitIndicator = {
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

  const ahead = Math.max(0, status.ahead)
  const behind = Math.max(0, status.behind)

  const parts: string[] = []
  if (ahead > 0) parts.push(`\u2191${String(ahead)}`)
  if (behind > 0) parts.push(`\u2193${String(behind)}`)

  if (parts.length === 0) return EMPTY_INDICATOR

  return {
    ahead,
    behind,
    label: parts.join(' '),
    description: buildDescription({ ahead, behind }),
  }
}

function buildDescription(input: { ahead: number; behind: number }) {
  const clauses: string[] = []
  if (input.ahead > 0)
    clauses.push(`${String(input.ahead)} commit${input.ahead === 1 ? '' : 's'} ahead`)
  if (input.behind > 0) {
    clauses.push(`${String(input.behind)} commit${input.behind === 1 ? '' : 's'} behind`)
  }
  return clauses.join(', ')
}
