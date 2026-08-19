import type { SessionId } from '@shared/types/brand'
import type { GitFileDiff } from '@shared/types/git'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { splitUnifiedDiffIntoFileDiffs } from '@shared/utils/turn-diff-parse'
import { useEffect, useState } from 'react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-turns')
const EMPTY_TURNS: readonly TurnCheckpointSummary[] = []
const EMPTY_FILES: readonly GitFileDiff[] = []
const TURN_DIFF_MISSING_MESSAGE =
  "This turn's checkpoint is no longer stored, so its diff cannot be shown."
const TURN_DIFF_FAILED_MESSAGE = "This turn's diff could not be loaded."

/** A turn's files, whether they are still loading, and why they are absent when they are. */
export interface TurnDiffFiles {
  readonly files: readonly GitFileDiff[]
  readonly error: string | null
  /**
   * True while the checkpoint is being read.
   *
   * Without it the panel showed "No changes to review" until the read returned, and kept the
   * *previous* turn's files on screen under the newly selected turn's label - the same
   * unauditable-screen problem that was fixed for the failure case and left open in flight. Worse,
   * a comment written during that window took its snippet from the old turn's patch while being
   * stored against the new turn.
   */
  readonly isLoading: boolean
}

/** List the session's Turn checkpoints (WS6b/WS7), oldest first (ascending turn index). */
export function useSessionTurns(
  sessionId: SessionId | null,
  refreshToken: number = 0,
): readonly TurnCheckpointSummary[] {
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
        // refreshToken forces a refetch when a run completes (review renderer-M2).
        logger.warn('Failed to list turn checkpoints', { error: String(error), refreshToken })
        if (!cancelled) setTurns(EMPTY_TURNS)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, refreshToken])

  return turns
}

/** Fetch and shape the Turn diff for the selected turn into renderable files. */
export function useTurnDiffFiles(
  sessionId: SessionId | null,
  selection: DiffScopeSelection,
): TurnDiffFiles {
  const [files, setFiles] = useState<readonly GitFileDiff[]>(EMPTY_FILES)
  /**
   * A failed or missing turn diff, so it is not presented as a clean turn.
   *
   * An empty list rendered as "No changes to review", which told the user a past turn changed
   * nothing when the checkpoint could not be read - or had been pruned by retention - at all.
   */
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const turnId = selection.kind === 'turn' ? selection.turnId : null

  useEffect(() => {
    if (!sessionId || !turnId) {
      setFiles(EMPTY_FILES)
      setError(null)
      setIsLoading(false)
      return
    }
    // Clear first: the previous turn's files must not stand in for the one now selected.
    setFiles(EMPTY_FILES)
    setError(null)
    setIsLoading(true)
    let cancelled = false
    void (async () => {
      try {
        const turnDiff = await api.getTurnDiff(sessionId, turnId)
        if (cancelled) return
        if (!turnDiff) {
          setFiles(EMPTY_FILES)
          setError(TURN_DIFF_MISSING_MESSAGE)
          setIsLoading(false)
          return
        }
        setFiles(splitUnifiedDiffIntoFileDiffs(turnDiff.diff).map((diff) => ({ ...diff })))
        setError(null)
        setIsLoading(false)
      } catch (loadError) {
        logger.warn('Failed to load turn diff', { error: String(loadError) })
        if (cancelled) return
        setFiles(EMPTY_FILES)
        setError(TURN_DIFF_FAILED_MESSAGE)
        setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, turnId])

  return { files, error, isLoading }
}
