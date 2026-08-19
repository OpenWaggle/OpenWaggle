import type { PinnedSession, SessionSummary } from '@shared/types/session'

/**
 * Pinned section rows (issue #97).
 *
 * Pins arrive from the main process already in Manual order. Ordering here is a pure
 * function of the pins, the session list, and the active Pinned sort — the derived
 * sorts read session data and never write back, so Manual order survives switching
 * away and back.
 */

/** The rule ordering the Pinned section. `manual` is the user's dragged order. */
export const PINNED_SORT_MODES = ['manual', 'recent', 'oldest', 'name'] as const
export type PinnedSortMode = (typeof PINNED_SORT_MODES)[number]

export const DEFAULT_PINNED_SORT_MODE: PinnedSortMode = 'manual'

/** How many leading rows carry a Pinned shortcut (Mod+1..Mod+9). */
export const PINNED_SHORTCUT_LIMIT = 9

export interface PinnedSessionRow {
  readonly session: SessionSummary
  /** Manual-order key, kept so a drop can be expressed against its neighbours. */
  readonly sortKey: string
}

interface BuildPinnedSessionRowsInput {
  readonly pins: readonly PinnedSession[]
  /** Current (non-archived) sessions. Archived sessions keep their pin but no row. */
  readonly sessions: readonly SessionSummary[]
  readonly sortMode: PinnedSortMode
}

function comparePinnedRows(sortMode: PinnedSortMode) {
  return (left: PinnedSessionRow, right: PinnedSessionRow) => {
    if (sortMode === 'recent') return right.session.updatedAt - left.session.updatedAt
    if (sortMode === 'oldest') return left.session.updatedAt - right.session.updatedAt
    if (sortMode === 'name') return left.session.title.localeCompare(right.session.title)
    return left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0
  }
}

/**
 * The Pinned section, ordered by `sortMode`.
 *
 * A pin whose session is absent from `sessions` produces no row: that covers both an
 * archived session (pin kept, row hidden until unarchive) and a pin left behind by a
 * session that no longer exists, which must never render and never throw.
 */
export function buildPinnedSessionRows({
  pins,
  sessions,
  sortMode,
}: BuildPinnedSessionRowsInput): readonly PinnedSessionRow[] {
  const sessionsById = new Map(sessions.map((session) => [String(session.id), session]))
  const rows: PinnedSessionRow[] = []

  for (const pin of pins) {
    const session = sessionsById.get(String(pin.sessionId))
    if (!session) continue
    rows.push({ session, sortKey: pin.sortKey })
  }

  return rows.sort(comparePinnedRows(sortMode))
}

/**
 * The neighbours a dragged row lands between, as session ids.
 *
 * Expressed against what is currently rendered so the main process can resolve the
 * sort keys itself; the renderer never handles keys. `targetIndex` is the position the
 * row should occupy in the rendered list after the move.
 */
export function resolvePinnedDropNeighbours(
  rows: readonly PinnedSessionRow[],
  sessionId: string,
  targetIndex: number,
) {
  const remaining = rows.filter((row) => String(row.session.id) !== sessionId)
  const clamped = Math.max(0, Math.min(targetIndex, remaining.length))
  const after = remaining[clamped - 1]
  const before = remaining[clamped]
  return {
    afterSessionId: after ? after.session.id : null,
    beforeSessionId: before ? before.session.id : null,
  }
}
