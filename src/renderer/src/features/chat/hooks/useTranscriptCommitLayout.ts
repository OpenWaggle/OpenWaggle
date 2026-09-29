import { useLayoutEffect } from 'react'
import type { TranscriptViewportSession } from '../lib/transcript-viewport-session'

interface UseTranscriptCommitLayoutInput {
  readonly session: TranscriptViewportSession
  readonly keys: readonly string[]
  /** Row key of the latest user message. */
  readonly sentKey: string | null
  readonly userDidSend: boolean
  /** Whether the latest turn has tool calls or a Waggle turn, which is followed once it overflows. */
  readonly latestTurnHasWork: boolean
  readonly onUserDidSendConsumed: () => void
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
    session.setLatestTurnHasWork(input.latestTurnHasWork)
    const sentRowPresent = sentKey !== null && input.keys.includes(sentKey)
    if (input.userDidSend && sentRowPresent) {
      if (input.hasLater) {
        input.showNewest()
        return
      }
      session.anchorNewTurn(sentKey)
      input.onUserDidSendConsumed()
    }
    if (!input.userDidSend) session.reconcileSentTurn(sentKey)
    session.layout()
  })
}
