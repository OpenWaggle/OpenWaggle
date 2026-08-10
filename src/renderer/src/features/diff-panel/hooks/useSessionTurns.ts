import type { SessionId } from '@shared/types/brand'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { splitUnifiedDiffIntoFileDiffs } from '@shared/utils/turn-diff-parse'
import { useEffect, useState } from 'react'
import { buildDisplayItems } from '@/features/diff-panel/components/diff-display-items'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { RenderableDiffFile } from './useDiffPanelDiffs'

const logger = createRendererLogger('diff-panel-turns')
const EMPTY_TURNS: readonly TurnCheckpointSummary[] = []
const EMPTY_FILES: readonly RenderableDiffFile[] = []

/** List the session's Turn checkpoints (WS6b/WS7), newest first. */
export function useSessionTurns(sessionId: SessionId | null): readonly TurnCheckpointSummary[] {
  const [turns, setTurns] = useState<readonly TurnCheckpointSummary[]>(EMPTY_TURNS)

  useEffect(() => {
    if (!sessionId) {
      setTurns(EMPTY_TURNS)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await api.listTurnCheckpoints(sessionId)
        if (!cancelled) setTurns(result)
      } catch (error) {
        logger.warn('Failed to list turn checkpoints', { error: String(error) })
        if (!cancelled) setTurns(EMPTY_TURNS)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  return turns
}

/** Fetch and shape the Turn diff for the selected turn into renderable files. */
export function useTurnDiffFiles(
  sessionId: SessionId | null,
  selection: DiffScopeSelection,
): readonly RenderableDiffFile[] {
  const [files, setFiles] = useState<readonly RenderableDiffFile[]>(EMPTY_FILES)
  const turnId = selection.kind === 'turn' ? selection.turnId : null

  useEffect(() => {
    if (!sessionId || !turnId) {
      setFiles(EMPTY_FILES)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const turnDiff = await api.getTurnDiff(sessionId, turnId)
        if (cancelled) return
        const fileDiffs = turnDiff
          ? splitUnifiedDiffIntoFileDiffs(turnDiff.diff).map((diff) => ({
              ...diff,
              items: buildDisplayItems(diff.diff),
            }))
          : EMPTY_FILES
        setFiles(fileDiffs)
      } catch (error) {
        logger.warn('Failed to load turn diff', { error: String(error) })
        if (!cancelled) setFiles(EMPTY_FILES)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, turnId])

  return files
}
