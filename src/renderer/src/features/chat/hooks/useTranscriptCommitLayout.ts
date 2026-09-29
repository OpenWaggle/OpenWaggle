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
  const previousSentKey = useRef(sentKey)
  useLayoutEffect(() => {
    session.setWindowHasLater(input.hasLater)
    /*
     * Only a user row that arrived with or after the send is the sent message. The send can
     * commit before its optimistic row does, and the latest user row is then the previous turn's.
     */
    const sentArrived = sentKey !== previousSentKey.current
    previousSentKey.current = sentKey
    const sentRowPresent = sentKey !== null && input.keys.includes(sentKey)
    if (input.userDidSend && sentArrived && sentRowPresent) {
      if (input.hasLater) {
        input.showNewest()
        return
      }
      session.anchorNewTurn(sentKey, input.keys[input.keys.indexOf(sentKey) - 1] ?? null)
      input.onUserDidSendConsumed()
    }
    session.syncRows(transcriptRowIndex(input.rows, input.keys))
    session.layout()
  })
}
