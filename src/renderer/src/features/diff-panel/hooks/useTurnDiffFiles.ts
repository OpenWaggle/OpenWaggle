import type { SessionId } from '@shared/types/brand'
import type { GitFileDiff } from '@shared/types/git'
import { splitUnifiedDiffIntoFileDiffs } from '@shared/utils/turn-diff-parse'
import { useEffect, useState } from 'react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-turns')
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
  /** Re-read the checkpoint. The diff loader does not own this scope, so it cannot retry it. */
  readonly retry: () => void
}

/** A finished read of one turn's diff, for the request it answered. */
interface TurnDiffRead {
  readonly requestKey: string
  readonly files: readonly GitFileDiff[]
  /**
   * A failed or missing turn diff, so it is not presented as a clean turn.
   *
   * An empty list rendered as "No changes to review", which told the user a past turn changed
   * nothing when the checkpoint could not be read - or had been pruned by retention - at all.
   */
  readonly error: string | null
}

/** Fetch and shape the Turn diff for the selected turn into renderable files. */
export function useTurnDiffFiles(
  sessionId: SessionId | null,
  selection: DiffScopeSelection,
): TurnDiffFiles {
  const [read, setRead] = useState<TurnDiffRead | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const turnId = selection.kind === 'turn' ? selection.turnId : null
  const requestKey = sessionId && turnId ? `${sessionId}\u0000${turnId}\u0000${retryToken}` : null

  useEffect(() => {
    if (!sessionId || !turnId || requestKey === null) return
    logger.debug('Reading turn checkpoint', { turnId, retryToken })
    let cancelled = false
    void (async () => {
      try {
        const turnDiff = await api.getTurnDiff(sessionId, turnId)
        if (cancelled) return
        if (!turnDiff) {
          setRead({ requestKey, files: EMPTY_FILES, error: TURN_DIFF_MISSING_MESSAGE })
          return
        }
        setRead({
          requestKey,
          files: splitUnifiedDiffIntoFileDiffs(turnDiff.diff).map((diff) => ({ ...diff })),
          error: null,
        })
      } catch (loadError) {
        logger.warn('Failed to load turn diff', { error: String(loadError) })
        if (cancelled) return
        setRead({ requestKey, files: EMPTY_FILES, error: TURN_DIFF_FAILED_MESSAGE })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, turnId, retryToken, requestKey])

  const retry = () => setRetryToken((token) => token + 1)
  if (requestKey === null) return { files: EMPTY_FILES, error: null, isLoading: false, retry }
  // Only this read's files show: the previous turn's must not stand in for the one now selected.
  if (read === null || read.requestKey !== requestKey) {
    return { files: EMPTY_FILES, error: null, isLoading: true, retry }
  }
  return { files: read.files, error: read.error, isLoading: false, retry }
}
