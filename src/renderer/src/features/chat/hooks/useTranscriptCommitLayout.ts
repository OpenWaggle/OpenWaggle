import { useLayoutEffect } from 'react'
import type { TranscriptViewportSession } from '../lib/transcript-viewport-session'

interface UseTranscriptCommitLayoutInput {
  readonly session: TranscriptViewportSession
  readonly keys: readonly string[]
  /** Row key of the latest user message. */
  readonly sentKey: string | null
  readonly userDidSend: boolean
  readonly onUserDidSendConsumed: () => void
  readonly latestTurnHasToolActivity: boolean
  readonly hasLater: boolean
  readonly showNewest: () => void
}

/**
 * Applies the viewport after every commit, before paint (ADR 0036).
 *
 * A send anchors the new turn near the top; tool activity hands it over to live following; and the
 * controller re-applies its mode to the new layout.
 * Must be declared after the settle presentation hook so a fold is seen before the anchor moves.
 */
export function useTranscriptCommitLayout(input: UseTranscriptCommitLayoutInput) {
  const { session, sentKey } = input
  useLayoutEffect(() => {
    const mode = session.controller.mode
    const sentRowPresent = sentKey !== null && input.keys.includes(sentKey)
    if (input.userDidSend && sentRowPresent) {
      if (input.hasLater) {
        input.showNewest()
        return
      }
      session.anchorNewTurn(sentKey)
      input.onUserDidSendConsumed()
    }
    const sentReplaced =
      mode.kind === 'new-turn' &&
      sentKey !== null &&
      mode.key !== sentKey &&
      session.controller.hasMountedRow(sentKey)
    // The optimistic message was replaced by its persisted copy under a new id.
    if (!input.userDidSend && sentReplaced) session.anchorNewTurn(sentKey)
    if (input.latestTurnHasToolActivity) session.releaseNewTurn()
    session.layout()
  })
}
