import { useLayoutEffect } from 'react'
import { turnHasWork } from '../lib/transcript-rows'
import type { TranscriptViewportSession } from '../lib/transcript-viewport-session'
import type { ChatRow } from '../lib/types-chat-row'

interface UseTranscriptCommitLayoutInput {
  readonly session: TranscriptViewportSession
  readonly rows: readonly ChatRow[]
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
 * A send holds the new turn near the top until its content reaches the bottom of the viewport, and
 * the controller re-applies its mode to the new layout.
 * Must be declared after the settle presentation hook so a fold is seen before the anchor moves.
 */
export function useTranscriptCommitLayout(input: UseTranscriptCommitLayoutInput) {
  const { session, sentKey } = input
  useLayoutEffect(() => {
    session.setWindowHasLater(input.hasLater)
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
    // Work is judged over the whole held turn: a steer inside it is a user row, not a new turn.
    const heldKey = session.controller.sentTurnKey
    session.setTurnHasWork(heldKey !== null && turnHasWork(input.rows, input.keys, heldKey))
    session.layout()
  })
}
