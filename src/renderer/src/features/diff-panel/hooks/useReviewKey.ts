import { useEffect } from 'react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { reviewKeyFor, useReviewStore } from '@/features/diff-panel/state/review-store'

/**
 * The key the panel's pending review lives under, migrated when it changes underneath the user.
 *
 * Threads are keyed by session id once one exists and by working path before that, so two sessions
 * sharing one checkout keep separate reviews. Sessions are created lazily on the first send, which
 * switches the key mid-review: without moving the thread the panel starts reading an empty one while the
 * user's comments stay under the old key - invisible, unreachable, and not even pruned, because they are
 * not empty.
 */
export function useReviewKey(input: {
  readonly scopeKey: string
  readonly workingPath: string | null
  readonly selection: DiffScopeSelection
}) {
  const reviewKey = reviewKeyFor(input.scopeKey || null, input.selection)
  const draftKey = reviewKeyFor(input.workingPath, input.selection)
  const migrateReview = useReviewStore((state) => state.migrateReview)

  useEffect(() => {
    migrateReview(draftKey, reviewKey)
  }, [draftKey, reviewKey, migrateReview])

  return reviewKey
}
