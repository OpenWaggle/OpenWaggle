import { useLayoutEffect } from 'react'
import { transcriptRowIndex } from '../lib/transcript-rows'
import type { TranscriptViewportSession } from '../lib/transcript-viewport-session'
import type { ChatRow } from '../lib/types-chat-row'

interface UseTranscriptCommitLayoutInput {
  readonly session: TranscriptViewportSession
  readonly rows: readonly ChatRow[]
  readonly keys: readonly string[]
  /** Row key of the pending send's own optimistic message, once it is the latest user row. */
  readonly sentKey: string | null
  readonly onPendingSendConsumed: () => void
  readonly hasLater: boolean
  readonly showNewest: () => void
}

/**
 * Applies the viewport after every commit, before paint (ADR 0036).
 *
 * A send holds the new turn near the top until its content reaches the bottom of the viewport, and
 * the controller re-applies its mode to the new layout.
 * Must be declared after the settle presentation hook so a fold is seen before the anchor moves.
 */
export function useTranscriptCommitLayout(input: UseTranscriptCommitLayoutInput) {
  const { session, sentKey } = input
  useLayoutEffect(() => {
    session.setWindowHasLater(input.hasLater)
    if (sentKey !== null && input.keys.includes(sentKey)) {
      if (input.hasLater) {
        input.showNewest()
        return
      }
      session.anchorNewTurn(sentKey, input.keys[input.keys.indexOf(sentKey) - 1] ?? null)
      // Consuming here, in the same layout flush, is what anchors a send once: a deferred consume
      // would re-anchor it on every commit until the pending send cleared.
      input.onPendingSendConsumed()
    }
    session.syncRows(transcriptRowIndex(input.rows, input.keys))
    session.layout()
  })
}
