import { useState } from 'react'
import {
  extendEarlier,
  extendLater,
  isRangeCurrent,
  newestRange,
  rangeAround,
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

interface UseTranscriptWindowRangeInput {
  readonly rows: readonly ChatRow[]
  readonly keys: readonly string[]
  /** The saved reading position's row, which the first window is built around. */
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

  let current = range
  if (!isRangeCurrent(range, keys)) {
    current = range === null ? initialRange(keys, anchorKey) : reconcileRange(range, keys)
    setRange(current)
  }
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

  /** Releases the oldest rows once a live window outgrows the bound; only while following. */
  function trimForLiveEnd() {
    if (!current || !isFollowing()) return
    const trimmed = trimLiveWindow(current, keys)
    if (trimmed !== current) setRange(trimmed)
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
    trimForLiveEnd,
  }
}
