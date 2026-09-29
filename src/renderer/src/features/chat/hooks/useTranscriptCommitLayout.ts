import { useLayoutEffect } from 'react'
import type { TranscriptViewportSession } from '../lib/transcript-viewport-session'

interface UseTranscriptCommitLayoutInput {
  readonly session: TranscriptViewportSession
  readonly keys: readonly string[]
  /** Row key of the latest user message. */
  readonly sentKey: string | null
  readonly userDidSend: boolean
  readonly onUserDidSendConsumed: () => void
  readonly hasLater: boolean
  readonly showNewest: () => void
}

/**
 * Applies the viewport after every commit, before paint (ADR 0036).
 *
 * A send holds the new turn near the top until the reader scrolls, and the controller re-applies
 * its mode to the new layout.
 * Must be declared after the settle presentation hook so a fold is seen before the anchor moves.
 */
export function useTranscriptCommitLayout(input: UseTranscriptCommitLayoutInput) {
  const { session, sentKey } = input
  useLayoutEffect(() => {
    session.setWindowHasLater(input.hasLater)
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
    const { controller } = session
    const reservedKey = controller.sentTurnKey
    // The optimistic message was replaced by its persisted copy under a new id. A reader who
    // scrolled inside the turn keeps its reserved space only while that row is really gone.
    const sentReplaced =
      reservedKey !== null &&
      sentKey !== null &&
      reservedKey !== sentKey &&
      controller.hasMountedRow(sentKey) &&
      (mode.kind === 'new-turn' || !controller.hasMountedRow(reservedKey))
    if (!input.userDidSend && sentReplaced) session.replaceSentTurn(sentKey)
    session.layout()
  })
}
