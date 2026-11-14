import type { SessionId } from '@shared/types/brand'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { useEffect, useState } from 'react'
import { readTurnCheckpoints } from '@/queries/turn-checkpoints'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-turns')
const EMPTY_TURNS: readonly TurnCheckpointSummary[] = []

/** List the session's Turn checkpoints (WS6b/WS7), oldest first (ascending turn index). */
export function useSessionTurns(sessionId: SessionId | null, refreshToken = 0) {
  // Kept with its session: a refresh keeps the list on screen, another session never shows it.
  const [loaded, setLoaded] = useState<{
    readonly sessionId: SessionId
    readonly turns: readonly TurnCheckpointSummary[]
  } | null>(null)

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void (async () => {
      try {
        // Every view asking together shares one read (B5).
        const result = await readTurnCheckpoints(sessionId)
        if (!cancelled) setLoaded({ sessionId, turns: result })
      } catch (error) {
        // refreshToken forces a refetch when a run completes (review renderer-M2).
        logger.warn('Failed to list turn checkpoints', { error: String(error), refreshToken })
        if (!cancelled) setLoaded({ sessionId, turns: EMPTY_TURNS })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, refreshToken])

  return loaded !== null && loaded.sessionId === sessionId ? loaded.turns : EMPTY_TURNS
}
