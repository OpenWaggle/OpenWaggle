import type { SessionId } from '@shared/types/brand'
import { useMemo } from 'react'
import { useDiffScopeStore, useSessionTurns } from '@/features/diff-panel'

type TurnRevealNavigate = (options: {
  to: '/sessions/$sessionId'
  params: { sessionId: string }
  search: (previous: Record<string, unknown>) => Record<string, unknown>
}) => Promise<void> | void

/**
 * Transcript turn-reveal (WS6b): maps assistant messages to their Turn
 * checkpoint via the checkpoint anchor node id, and reveals a turn's diff by
 * selecting it and opening the diff panel.
 */
export function useTurnReveal(activeSessionId: SessionId | null, navigate: TurnRevealNavigate) {
  const turns = useSessionTurns(activeSessionId)
  const turnAnchorMessageIds = useMemo(
    () => new Set(turns.flatMap((turn) => (turn.anchorNodeId ? [turn.anchorNodeId] : []))),
    [turns],
  )

  function handleViewTurnDiff(messageId: string) {
    if (!activeSessionId) return
    const turn = turns.find((candidate) => candidate.anchorNodeId === messageId)
    if (!turn) return
    useDiffScopeStore.getState().selectTurn(String(activeSessionId), turn.turnId)
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(activeSessionId) },
      search: (previous) => ({ ...previous, panel: 'diff' }),
    })
  }

  return { turnAnchorMessageIds, handleViewTurnDiff }
}
