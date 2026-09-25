/**
 * The bounded sliding window over a transcript's rows (ADR 0036).
 *
 * The window is identified by row keys, never by a count of hidden rows. A hidden-row count set once
 * at mount sliced unrelated lists whenever the rows changed shape within one Session: a branch switch
 * from 400 to 60 messages left one row visible, and a window mounted before hydration rendered every
 * row.
 */

export const TRANSCRIPT_WINDOW_LIMITS = {
  /** Rows built when a transcript opens at its newest end. */
  initialRows: 40,
  /** Rows added per automatic load at either edge. */
  batchRows: 40,
  /** Mounted rows beyond which the far edge is released. */
  maxRows: 160,
  /** Rows kept above a restored anchor so the reader has context. */
  rowsBeforeAnchor: 20,
} as const

export interface TranscriptWindowRange {
  readonly startKey: string
  /** `null` follows the live end, so rows that arrive are rendered. */
  readonly endKey: string | null
  /**
   * The keys the window covered when it was set, in order. When an edge row disappears (a turn
   * folds, a disclosure collapses) the edge moves to the nearest member that survived.
   */
  readonly members: readonly string[]
}

export interface ResolvedTranscriptWindow {
  readonly start: number
  /** Exclusive. */
  readonly end: number
  readonly hasEarlier: boolean
  readonly hasLater: boolean
}

interface Limits {
  readonly batchRows: number
  readonly maxRows: number
}

function keyAt(keys: readonly string[], index: number) {
  const key = keys[index]
  if (key === undefined) throw new Error(`Transcript window index ${String(index)} is out of range`)
  return key
}

function rangeFromIndexes(
  keys: readonly string[],
  start: number,
  end: number,
): TranscriptWindowRange {
  return {
    startKey: keyAt(keys, start),
    endKey: end >= keys.length ? null : keyAt(keys, end - 1),
    members: keys.slice(start, end),
  }
}

/** The newest rows, following the live end. `null` for an empty transcript. */
export function newestRange(
  keys: readonly string[],
  initialRows: number = TRANSCRIPT_WINDOW_LIMITS.initialRows,
): TranscriptWindowRange | null {
  if (keys.length === 0) return null
  return rangeFromIndexes(keys, Math.max(0, keys.length - initialRows), keys.length)
}

/** A window that starts shortly above an anchored row, for restoring a reading position. */
export function rangeAround(
  keys: readonly string[],
  anchorKey: string,
  limits: {
    readonly maxRows: number
    readonly rowsBeforeAnchor: number
  } = TRANSCRIPT_WINDOW_LIMITS,
): TranscriptWindowRange | null {
  const anchor = keys.indexOf(anchorKey)
  if (anchor < 0) return null
  const start = Math.max(0, anchor - limits.rowsBeforeAnchor)
  return rangeFromIndexes(keys, start, Math.min(keys.length, start + limits.maxRows))
}

export function resolveRange(
  range: TranscriptWindowRange,
  keys: readonly string[],
): ResolvedTranscriptWindow | null {
  const start = keys.indexOf(range.startKey)
  if (start < 0) return null
  const endIndex = range.endKey === null ? keys.length - 1 : keys.indexOf(range.endKey)
  if (endIndex < start) return null
  const end = endIndex + 1
  return { start, end, hasEarlier: start > 0, hasLater: end < keys.length }
}

function firstSurvivor(members: readonly string[], present: ReadonlySet<string>) {
  return members.find((key) => present.has(key)) ?? null
}

function lastSurvivor(members: readonly string[], present: ReadonlySet<string>) {
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const key = members[index]
    if (key !== undefined && present.has(key)) return key
  }
  return null
}

function liveWindowNeedsFill(
  range: TranscriptWindowRange,
  resolved: ResolvedTranscriptWindow,
  initialRows: number,
) {
  return range.endKey === null && resolved.hasEarlier && resolved.end - resolved.start < initialRows
}

/** Whether a window still describes the current rows, so it needs no reconciliation. */
export function isRangeCurrent(
  range: TranscriptWindowRange | null,
  keys: readonly string[],
  initialRows: number = TRANSCRIPT_WINDOW_LIMITS.initialRows,
) {
  if (range === null) return keys.length === 0
  const resolved = resolveRange(range, keys)
  return resolved !== null && !liveWindowNeedsFill(range, resolved, initialRows)
}

/**
 * Carries a window across a change of the row list.
 *
 * A folded or collapsed row can take a window edge with it; the edge moves to the nearest member
 * that survived instead of resetting the reader to the newest end. When nothing the window covered
 * survives (compaction replaced the transcript), the window reopens at the newest end.
 */
export function reconcileRange(
  range: TranscriptWindowRange | null,
  keys: readonly string[],
  initialRows: number = TRANSCRIPT_WINDOW_LIMITS.initialRows,
): TranscriptWindowRange | null {
  if (keys.length === 0) return null
  if (range === null) return newestRange(keys, initialRows)
  const resolved = resolveRange(range, keys)
  if (resolved) {
    /*
     * History inserted above a live window that holds fewer than the initial rows (a window opened
     * on a lone "Thinking" row before hydration) fills back up to the initial rows.
     */
    return liveWindowNeedsFill(range, resolved, initialRows)
      ? rangeFromIndexes(keys, Math.max(0, resolved.end - initialRows), resolved.end)
      : range
  }

  const present = new Set(keys)
  const startKey = firstSurvivor(range.members, present)
  if (startKey === null) return newestRange(keys, initialRows)
  const start = keys.indexOf(startKey)
  if (range.endKey === null) return rangeFromIndexes(keys, start, keys.length)
  const endKey = lastSurvivor(range.members, present)
  const end = endKey === null ? -1 : keys.indexOf(endKey)
  if (end < start) return newestRange(keys, initialRows)
  return rangeFromIndexes(keys, start, end + 1)
}

export interface WindowExtension {
  readonly range: TranscriptWindowRange
  /** Rows added by this extension. */
  readonly added: number
}

/** Adds older rows at the top, releasing rows at the bottom beyond the bound. */
export function extendEarlier(
  range: TranscriptWindowRange,
  keys: readonly string[],
  limits: Limits = TRANSCRIPT_WINDOW_LIMITS,
): WindowExtension {
  const resolved = resolveRange(range, keys)
  if (!resolved || resolved.start === 0) return { range, added: 0 }
  const start = Math.max(0, resolved.start - limits.batchRows)
  const end = Math.min(resolved.end, start + limits.maxRows)
  return { range: rangeFromIndexes(keys, start, end), added: resolved.start - start }
}

/** Adds newer rows at the bottom, releasing rows at the top beyond the bound. */
export function extendLater(
  range: TranscriptWindowRange,
  keys: readonly string[],
  limits: Limits = TRANSCRIPT_WINDOW_LIMITS,
): WindowExtension {
  const resolved = resolveRange(range, keys)
  if (!resolved?.hasLater) return { range, added: 0 }
  const end = Math.min(keys.length, resolved.end + limits.batchRows)
  const start = Math.max(resolved.start, end - limits.maxRows)
  return { range: rangeFromIndexes(keys, start, end), added: end - resolved.end }
}

/**
 * Releases the oldest mounted rows once the live window outgrows the bound.
 *
 * Only for a reader following the live end: trimming above someone reading older rows would move
 * the rows they are reading.
 */
export function trimLiveWindow(
  range: TranscriptWindowRange,
  keys: readonly string[],
  maxRows: number = TRANSCRIPT_WINDOW_LIMITS.maxRows,
): TranscriptWindowRange {
  const resolved = resolveRange(range, keys)
  if (!resolved || range.endKey !== null || resolved.end - resolved.start <= maxRows) return range
  return rangeFromIndexes(keys, resolved.end - maxRows, resolved.end)
}
