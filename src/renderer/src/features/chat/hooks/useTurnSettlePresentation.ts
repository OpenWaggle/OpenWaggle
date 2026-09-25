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
  readonly keys: readonly string[]
  readonly rowsByKey: ReadonlyMap<string, ChatRow>
  readonly isLoading: boolean
  /** Rows the reader could see when this was committed. */
  readonly visible: ReadonlySet<string>
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function removedBlock(previous: CommittedTranscript, present: ReadonlySet<string>) {
  const removed: ChatRow[] = []
  let beforeKey: string | null = null
  for (const key of previous.keys) {
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

interface UseTurnSettlePresentationInput {
  readonly rows: readonly ChatRow[]
  readonly keys: readonly string[]
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
  isLoading,
  viewport,
  onToggleTurnFold,
}: UseTurnSettlePresentationInput) {
  const [exiting, setExiting] = useState<ExitingRows | null>(null)
  const committedRef = useRef<CommittedTranscript | null>(null)

  useLayoutEffect(() => {
    const previous = committedRef.current
    const rowsByKey = new Map<string, ChatRow>()
    keys.forEach((key, index) => {
      const row = rows[index]
      if (row) rowsByKey.set(key, row)
    })
    const visible = viewport.visibleRowKeys()
    committedRef.current = { keys, rowsByKey, isLoading, visible }
    if (!previous?.isLoading || isLoading) return

    const present = new Set(keys)
    const { removed, beforeKey } = removedBlock(previous, present)
    if (removed.length === 0) return
    const controller = viewport.controller
    const previousKeys = new Set(previous.keys)
    const foldKey = newestFoldKey(keys, previousKeys)
    // The reader was looking at rows this fold removes: keep the turn open under them.
    const readingInsideTurn =
      !controller.isFollowing &&
      previous.keys.some((key) => !present.has(key) && previous.visible.has(key))
    if (readingInsideTurn && foldKey) {
      viewport.skipLayoutForThisCommit()
      onToggleTurnFold(foldKey.slice(TURN_FOLD_KEY_PREFIX.length))
      return
    }
    if (controller.isFollowing && !prefersReducedMotion()) {
      setExiting({ id: Date.now(), rows: removed, beforeKey })
    }
  }, [rows, keys, isLoading, viewport, onToggleTurnFold])

  return { exiting, clearExiting: () => setExiting(null) }
}
