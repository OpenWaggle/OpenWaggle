import type { SessionId } from '@shared/types/brand'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
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
export function useTurnReveal(
  activeSessionId: SessionId | null,
  navigate: TurnRevealNavigate,
  refreshToken = 0,
) {
  const turns = useSessionTurns(activeSessionId, refreshToken)
  const turnAnchorMessageIds = useMemo(
    () => new Set(turns.flatMap((turn) => (turn.anchorNodeId ? [turn.anchorNodeId] : []))),
    [turns],
  )
  const turnDurationsByAnchorMessageId = useMemo(() => {
    const durations = new Map<string, number>()
    for (const turn of turns) {
      if (!turn.anchorNodeId || turn.startedAt === undefined || turn.startedAt === null) continue
      const durationMs = turn.createdAt - turn.startedAt
      if (durationMs > 0) durations.set(turn.anchorNodeId, durationMs)
    }
    return durations
  }, [turns])
  const turnsByAnchorNodeId = useMemo(() => {
    const byAnchor = new Map<string, TurnCheckpointSummary>()
    for (const turn of turns) {
      if (turn.anchorNodeId) byAnchor.set(turn.anchorNodeId, turn)
    }
    return byAnchor
  }, [turns])

  function handleViewTurnDiff(messageId: string, filePath?: string) {
    if (!activeSessionId) return
    const turn = turns.find((candidate) => candidate.anchorNodeId === messageId)
    if (!turn) return
    useDiffScopeStore.getState().selectTurn(String(activeSessionId), turn.turnId, filePath)
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(activeSessionId) },
      search: (previous) => ({ ...previous, panel: 'diff' }),
    })
  }

  return {
    turnAnchorMessageIds,
    turnDurationsByAnchorMessageId,
    turnsByAnchorNodeId,
    handleViewTurnDiff,
  }
}
