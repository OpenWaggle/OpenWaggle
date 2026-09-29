import { useLayoutEffect, useRef } from 'react'
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
  /**
   * Whether this mount may consume the send. A new Session's view remounts once its branch is
   * known; until then the send stays pending, so the remounted view holds the message again.
   */
  readonly canConsumePendingSend: boolean
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
  /*
   * The sent row this mount has held. A send this mount may not consume stays pending across its
   * commits (`canConsumePendingSend`), and this is what anchors it only once: re-anchoring every
   * commit pinned the message again and never let a working turn be followed.
   */
  const anchoredSentKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    session.setWindowHasLater(input.hasLater)
    if (sentKey !== null && sentKey !== anchoredSentKey.current && input.keys.includes(sentKey)) {
      if (input.hasLater) {
        input.showNewest()
        return
      }
      anchoredSentKey.current = sentKey
      session.anchorNewTurn(sentKey, input.keys[input.keys.indexOf(sentKey) - 1] ?? null)
      if (input.canConsumePendingSend) input.onPendingSendConsumed()
    }
    session.syncRows(transcriptRowIndex(input.rows, input.keys))
    session.layout()
  })
}
