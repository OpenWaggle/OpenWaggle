import { isMatching, P } from '@diegogbrisa/ts-match'
import type { ReadingPosition } from './transcript-viewport-controller'

/**
 * Reading positions per Session and branch, saved as a row anchor rather than a pixel offset
 * (ADR 0036).
 *
 * A pixel offset saved from an expanded window landed on a different message once the window
 * reopened at its newest rows. A row key and its offset survive the window, the viewport size, and
 * late layout such as highlighted code.
 */

const STORAGE_KEY = 'openwaggle:transcript-reading-positions:v2'
const MAX_ENTRIES = 100

/** `null` means the reader left the transcript following its live end. */
export type SavedReadingPosition = ReadingPosition | null

const entryPattern = P.tuple([P.string, P.union(P.null, { key: P.string, top: P.finite })])

function readEntry(entry: unknown): [string, SavedReadingPosition] | null {
  if (!isMatching(entryPattern, entry)) return null
  const [key, position] = entry
  return [key, position === null ? null : { key: position.key, top: position.top }]
}

export function readingPositionKey(sessionId: string, branchId: string | null) {
  return `${sessionId}:${branchId ?? 'main'}`
}

export function loadReadingPositions(): Map<string, SavedReadingPosition> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const entries: Array<[string, SavedReadingPosition]> = []
    for (const candidate of parsed) {
      const entry = readEntry(candidate)
      if (entry) entries.push(entry)
    }
    return new Map(entries)
  } catch {
    return new Map()
  }
}

export function saveReadingPositions(positions: Map<string, SavedReadingPosition>) {
  while (positions.size > MAX_ENTRIES) {
    const oldest: string | undefined = positions.keys().next().value
    if (oldest === undefined) break
    positions.delete(oldest)
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...positions]))
  } catch {
    // Storage is best effort; a missing position opens at the newest end.
  }
}

/** Records a position as the most recently used entry. */
export function rememberReadingPosition(
  positions: Map<string, SavedReadingPosition>,
  key: string,
  position: SavedReadingPosition,
) {
  positions.delete(key)
  positions.set(key, position)
}
