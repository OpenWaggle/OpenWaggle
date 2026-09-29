import { useLayoutEffect, useRef } from 'react'
import { transcriptRowIndex } from '../lib/transcript-rows'
import type { TranscriptViewportSession } from '../lib/transcript-viewport-session'
import type { ChatRow } from '../lib/types-chat-row'

interface UseTranscriptCommitLayoutInput {
  readonly session: TranscriptViewportSession
  readonly rows: readonly ChatRow[]
  readonly keys: readonly string[]
  /** Row key of the latest user message. */
  readonly sentKey: string | null
  /** Whether the latest user message is the optimistic copy of a send. */
  readonly sentIsOptimistic: boolean
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
  /** The sent row this viewport last held, so a send is anchored once. */
  const anchoredSentKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    session.setWindowHasLater(input.hasLater)
    /*
     * The sent message is the optimistic copy of the send, not merely the latest user row. The
     * send can commit before its optimistic row does, a capped window first has to show its newest
     * rows, and a new Session's viewport can mount with the row already present; the previous
     * turn's message being persisted meanwhile is not the send.
     */
    const sentPending =
      input.userDidSend &&
      input.sentIsOptimistic &&
      sentKey !== null &&
      sentKey !== anchoredSentKey.current &&
      input.keys.includes(sentKey)
    if (sentPending) {
      if (input.hasLater) {
        input.showNewest()
        return
      }
      anchoredSentKey.current = sentKey
      session.anchorNewTurn(sentKey, input.keys[input.keys.indexOf(sentKey) - 1] ?? null)
      input.onUserDidSendConsumed()
    }
    session.syncRows(transcriptRowIndex(input.rows, input.keys))
    session.layout()
  })
}
