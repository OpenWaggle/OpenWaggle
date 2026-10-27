import { useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptViewportSession } from '../lib/transcript-viewport-session'
import type { ChatRow } from '../lib/types-chat-row'

const TURN_FOLD_KEY_PREFIX = 'turn-fold:'

export interface ExitingRows {
  readonly id: number
  readonly rows: readonly ChatRow[]
  /** The surviving row the exiting rows collapse above; `null` for the end of the window. */
  readonly beforeKey: string | null
}

interface CommittedTranscript {
  /** Only the rows that were mounted: nothing outside the window is ever animated. */
  readonly mountedKeys: readonly string[]
  readonly rowsByKey: ReadonlyMap<string, ChatRow>
  readonly isLoading: boolean
  /**
   * Rows the reader could see when this was committed, measured only while a run streams and the
   * reader is not at the live end or a held turn; `null` when nothing was measured.
   */
  readonly visible: ReadonlySet<string> | null
}

/** Whether a settle folds under the reader rather than where the reader is looking. */
function foldsUnderReader(viewport: TranscriptViewportSession) {
  return viewport.controller.isFollowing || viewport.controller.isHoldingSentTurn
}

/**
 * The rows the reader could see before this commit.
 *
 * Measuring forces layout and reads every visible row's box, and it ran on every streamed token
 * although only a settle reads it, and only for a reader who scrolled away from the live end
 * (B3). A reader who left the live end after the last streamed commit was not measured; their
 * anchored row stands in.
 */
function visibleBefore(previous: CommittedTranscript, viewport: TranscriptViewportSession) {
  if (previous.visible) return previous.visible
  const mode = viewport.controller.mode
  return mode.kind === 'anchored' ? new Set([mode.key]) : new Set<string>()
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function mapRows(rows: readonly ChatRow[], keys: readonly string[]) {
  const byKey = new Map<string, ChatRow>()
  keys.forEach((key, index) => {
    const row = rows[index]
    if (row) byKey.set(key, row)
  })
  return byKey
}

function removedBlock(previous: CommittedTranscript, present: ReadonlySet<string>) {
  const removed: ChatRow[] = []
  let beforeKey: string | null = null
  for (const key of previous.mountedKeys) {
    const row = previous.rowsByKey.get(key)
    if (!present.has(key)) {
      if (row) removed.push(row)
      continue
    }
    if (removed.length > 0 && beforeKey === null) beforeKey = key
  }
  return { removed, beforeKey }
}

/** The fold row this settle introduced; the newest one when a Waggle run folds several turns. */
function newestFoldKey(keys: readonly string[], previousKeys: ReadonlySet<string>) {
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index]
    if (key?.startsWith(TURN_FOLD_KEY_PREFIX) && !previousKeys.has(key)) return key
  }
  return null
}

/**
 * A Waggle turn folds in place under the same row key, so no row disappears: find the visible
 * Waggle row that just folded and return its fold's turn key.
 */
function foldedVisibleWaggleTurn(
  previous: CommittedTranscript,
  visible: ReadonlySet<string>,
  current: ReadonlyMap<string, ChatRow>,
) {
  for (const key of visible) {
    const before = previous.rowsByKey.get(key)
    const after = current.get(key)
    if (before?.type !== 'waggle-turn' || after?.type !== 'waggle-turn') continue
    if (!before.folded && after.folded && after.foldRow) return after.foldRow.turnKey
  }
  return null
}

interface UseTurnSettlePresentationInput {
  readonly rows: readonly ChatRow[]
  readonly keys: readonly string[]
  /** Window bounds; only these rows were mounted. */
  readonly start: number
  readonly end: number
  readonly isLoading: boolean
  readonly viewport: TranscriptViewportSession
  readonly onToggleTurnFold: (turnKey: string) => void
}

/**
 * How a settling turn folds (ADR 0036, refining ADR 0034).
 *
 * The fold removes a turn's work rows in one commit, which removed about a thousand pixels in a
 * single frame on a real run. A reader following the live end sees the work collapse instead; a
 * reader scrolled inside the settling turn keeps it expanded, so nothing disappears under them.
 */
export function useTurnSettlePresentation({
  rows,
  keys,
  start,
  end,
  isLoading,
  viewport,
  onToggleTurnFold,
}: UseTurnSettlePresentationInput) {
  const [exiting, setExiting] = useState<ExitingRows | null>(null)
  const committedRef = useRef<CommittedTranscript | null>(null)

  useLayoutEffect(() => {
    const previous = committedRef.current
    const mountedKeys = keys.slice(start, end)
    const rowsByKey = mapRows(rows.slice(start, end), mountedKeys)
    committedRef.current = {
      mountedKeys,
      rowsByKey,
      isLoading,
      visible: isLoading && !foldsUnderReader(viewport) ? viewport.visibleRowKeys() : null,
    }
    if (!previous?.isLoading || isLoading) return

    const present = new Set(keys)
    const { removed, beforeKey } = removedBlock(previous, present)
    const foldKey = newestFoldKey(keys, new Set(previous.mountedKeys))
    /*
     * A held sent turn keeps its message fixed near the top, so its work can fold away below it
     * like it does for a follower; only a reader who scrolled into the turn keeps it open.
     */
    const underReader = foldsUnderReader(viewport)
    const visible = underReader ? new Set<string>() : visibleBefore(previous, viewport)
    // The reader was looking at rows this fold removes: keep the turn open under them.
    const readingInsideTurn =
      !underReader && previous.mountedKeys.some((key) => !present.has(key) && visible.has(key))
    const waggleTurnKey = underReader ? null : foldedVisibleWaggleTurn(previous, visible, rowsByKey)
    const reopenKey =
      readingInsideTurn && foldKey ? foldKey.slice(TURN_FOLD_KEY_PREFIX.length) : waggleTurnKey
    if (reopenKey) {
      viewport.skipLayoutForThisCommit()
      onToggleTurnFold(reopenKey)
      return
    }
    if (removed.length > 0 && underReader && !prefersReducedMotion()) {
      setExiting({ id: Date.now(), rows: removed, beforeKey })
    }
  }, [rows, keys, start, end, isLoading, viewport, onToggleTurnFold])

  return { exiting, clearExiting: () => setExiting(null) }
}
