import { useEffect, useRef } from 'react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { reviewKeyFor, useReviewStore } from '@/features/diff-panel/state/review-store'

/**
 * The key the panel's pending review lives under, carried across the one transition that changes it.
 *
 * Threads are keyed by session id once one exists and by working path before that, so two sessions
 * sharing one checkout keep separate reviews. Sessions are created lazily on the first send, which
 * switches this panel's key mid-review: without moving the thread the panel starts reading an empty one
 * while the user's comments stay under the old key - invisible, unreachable, and not even pruned,
 * because they are not empty.
 *
 * The move happens only when *this* panel's key changes from the draft key to a session key. An
 * unconditional migration was worse than the bug it fixed: in local mode every session in a project
 * shares one working path, so a draft review was claimed by whichever already-created session's panel
 * mounted next and merged into that session's own thread - posting one session's comments into another
 * conversation, which is exactly what keying reviews was introduced to prevent.
 */
export function useReviewKey(input: {
  readonly scopeKey: string
  readonly workingPath: string | null
  readonly selection: DiffScopeSelection
}) {
  const reviewKey = reviewKeyFor(input.scopeKey || null, input.selection)
  const draftKey = reviewKeyFor(input.workingPath, input.selection)
  const migrateReview = useReviewStore((state) => state.migrateReview)
  const previousKey = useRef(reviewKey)

  useEffect(() => {
    const cameFromDraft = previousKey.current === draftKey && reviewKey !== draftKey
    previousKey.current = reviewKey
    if (cameFromDraft) migrateReview(draftKey, reviewKey)
  }, [draftKey, reviewKey, migrateReview])

  return reviewKey
}
