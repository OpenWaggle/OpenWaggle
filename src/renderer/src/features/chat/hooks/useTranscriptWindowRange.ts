import { useState } from 'react'
import {
  capAnchoredLiveWindow,
  extendEarlier,
  extendLater,
  isRangeCurrent,
  newestRange,
  rangeAround,
  rangeIncludes,
  reconcileRange,
  resolveRange,
  TRANSCRIPT_WINDOW_LIMITS,
  type TranscriptWindowRange,
  trimLiveWindow,
} from '../lib/transcript-window'
import type { ChatRow } from '../lib/types-chat-row'

/** Unbounded limits: a reader following the live end never has rows released under them. */
const FOLLOWING_LIMITS = { ...TRANSCRIPT_WINDOW_LIMITS, maxRows: Number.MAX_SAFE_INTEGER }

function countMessages(rows: readonly ChatRow[]) {
  let count = 0
  for (const row of rows) {
    if (row.type === 'message') count += 1
    if (row.type === 'waggle-turn') count += row.messages.length
  }
  return count
}

function initialRange(keys: readonly string[], anchorKey: string | null) {
  return (anchorKey ? rangeAround(keys, anchorKey) : null) ?? newestRange(keys)
}

function currentRange(
  range: TranscriptWindowRange | null,
  keys: readonly string[],
  anchorKey: string | null,
) {
  const reconciled = isRangeCurrent(range, keys)
    ? range
    : range === null
      ? initialRange(keys, anchorKey)
      : reconcileRange(range, keys)
  // A first render with only a status row or partial history opened at the newest rows; once the
  // saved row arrives, rebuild around it so the pending restore can find it.
  const anchorArrived = anchorKey !== null && keys.includes(anchorKey)
  if (reconciled && anchorArrived && !rangeIncludes(reconciled, keys, anchorKey)) {
    return rangeAround(keys, anchorKey)
  }
  return reconciled
}

interface UseTranscriptWindowRangeInput {
  readonly rows: readonly ChatRow[]
  readonly keys: readonly string[]
  /**
   * The row of a reading position still waiting to be restored. The window is built around it,
   * including when it only arrives with a later hydration commit.
   */
  readonly anchorKey: string | null
  readonly isFollowing: () => boolean
}

/**
 * Which rows are mounted (ADR 0036).
 *
 * The range is reconciled during render rather than in an effect, so a changed row list never
 * paints one frame of the previous window: the branch-switch bug painted a single row for exactly
 * that reason.
 */
export function useTranscriptWindowRange({
  rows,
  keys,
  anchorKey,
  isFollowing,
}: UseTranscriptWindowRangeInput) {
  const [range, setRange] = useState<TranscriptWindowRange | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const current = currentRange(range, keys, anchorKey)
  if (current !== range) setRange(current)
  const resolved = current ? resolveRange(current, keys) : null

  function loadEarlier() {
    if (!current || !resolved?.hasEarlier) return
    const next = extendEarlier(current, keys, isFollowing() ? FOLLOWING_LIMITS : undefined)
    if (next.added === 0) return
    const loaded = countMessages(rows.slice(resolved.start - next.added, resolved.start))
    setRange(next.range)
    setAnnouncement(`${String(loaded)} earlier ${loaded === 1 ? 'message' : 'messages'} loaded`)
  }

  function loadLater() {
    if (!current || !resolved?.hasLater) return
    const next = extendLater(current, keys)
    if (next.added > 0) setRange(next.range)
  }

  function showNewest() {
    setRange(newestRange(keys))
  }

  /**
   * Keeps a live window within its bound as rows arrive: a reader following the end sheds the
   * oldest rows; an anchored reader keeps them and sheds the newest, which load back on scroll.
   */
  function boundLiveWindow() {
    if (!current) return
    const bounded = isFollowing()
      ? trimLiveWindow(current, keys)
      : capAnchoredLiveWindow(current, keys)
    if (bounded !== current) setRange(bounded)
  }

  return {
    start: resolved?.start ?? 0,
    end: resolved?.end ?? 0,
    hasEarlier: resolved?.hasEarlier ?? false,
    hasLater: resolved?.hasLater ?? false,
    announcement,
    loadEarlier,
    loadLater,
    showNewest,
    boundLiveWindow,
  }
}
