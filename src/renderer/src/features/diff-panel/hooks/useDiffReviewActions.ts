import type { GitFileDiff } from '@shared/types/git'
import { useEffect, useRef } from 'react'
import { wasMessageDelivered } from '@/features/chat/lib'
import {
  extractDiffSnippet,
  formatReviewSubmission,
  formatSingleReviewComment,
  type ReviewCommentWithSnippet,
} from '@/features/diff-panel/lib/review-comment-payload'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { selectReviewThread, useReviewStore } from '@/features/diff-panel/state/review-store'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('diff-panel-review')

function buildComment(
  files: readonly GitFileDiff[],
  location: ReviewCommentLocation,
  content: string,
): ReviewCommentWithSnippet {
  const endLine = location.endLine ?? location.line
  const patch = files.find((file) => file.path === location.filePath)?.diff ?? ''
  return {
    id: crypto.randomUUID(),
    filePath: location.filePath,
    startLine: location.line,
    endLine,
    content,
    createdAt: Date.now(),
    // Captured now, while the patch that the comment refers to is still on screen.
    diff: patch === '' ? '' : extractDiffSnippet(patch, location.line, endLine),
    // Kept so the saved marker is drawn on the side the reviewer commented on.
    lineType: location.lineType,
  }
}

/**
 * Review actions for the diff panel.
 *
 * Two paths, both self-contained in the panel: send one comment immediately, or
 * accumulate a Review and submit it with an optional summary as a single message.
 * Neither touches the composer.
 */
export function useDiffReviewActions(
  onSendMessage: (content: string) => void | Promise<void>,
  files: readonly GitFileDiff[],
  reviewKey: string,
  /** The key this panel would use with no session yet: see the follow rule below. */
  draftKey: string,
  onReviewSendFailed?: (error: unknown) => void,
) {
  const thread = useReviewStore((s) => selectReviewThread(s, reviewKey))
  /*
   * The key the panel is reading *now*, which the first send changes mid-flight: creating a session sets
   * the active id synchronously, so the panel moves from the working path to the session id before the send
   * can reject. Restoring under the key captured at click time therefore wrote the review where nothing was
   * reading, and the one-shot migration had already fired against the emptied draft.
   *
   * The draft key is tracked alongside it because "the key changed" is not on its own a reason to follow.
   * It also changes for a scope tab, a base ref, a turn, a session switch and a project switch, and
   * following those *moves* the thread: comments and line anchors taken from one diff would sit pending in
   * another, or one session's review in another session's conversation - which is what keying reviews was
   * introduced to prevent. Only one transition is legitimate, the same working tree and scope gaining a
   * session id, and that is exactly the transition in which the draft key does not move.
   */
  const latestReviewKey = useRef(reviewKey)
  const latestDraftKey = useRef(draftKey)
  useEffect(() => {
    latestReviewKey.current = reviewKey
    latestDraftKey.current = draftKey
  }, [reviewKey, draftKey])
  const comments = thread.comments
  const summary = thread.summary
  const addComment = useReviewStore((s) => s.addComment)
  const removeComment = useReviewStore((s) => s.removeComment)
  const setSummary = useReviewStore((s) => s.setSummary)
  const discardReview = useReviewStore((s) => s.discardReview)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)

  function onAddSingleComment(location: ReviewCommentLocation, content: string) {
    onSendMessage(formatSingleReviewComment(buildComment(files, location, content)))
    setActiveCommentLocation(reviewKey, null)
  }

  function onAddToReview(location: ReviewCommentLocation, content: string) {
    addComment(reviewKey, buildComment(files, location, content))
  }

  async function onSubmitReview() {
    // Read imperatively rather than from the render closure. `comments` here is the
    // value from the last render, so a rapid double-click (or a key repeat on the
    // Cmd+Enter shortcut) fires this twice before React re-renders with the cleared
    // array: both calls pass the emptiness guard and the agent receives the same
    // review twice.
    const state = useReviewStore.getState()
    const pending = selectReviewThread(state, reviewKey)
    if (pending.comments.length === 0) return
    /*
     * Taken out of the store before awaiting, and put back if the send fails.
     *
     * Both properties matter and they pull in opposite directions. Clearing only *after* a
     * successful send lets a rapid double-click send the same review twice, because the second call
     * reads the store before the first await resolves. Clearing first and never restoring destroys
     * everything the reviewer wrote when the send rejects - which main does outright for a missing
     * session worktree. Removing it synchronously satisfies the double-submit guard; restoring on
     * failure keeps the work.
     */
    state.clearComments(reviewKey)
    try {
      await onSendMessage(formatReviewSubmission(pending.summary, pending.comments))
    } catch (error) {
      /*
       * A run that failed after the message arrived is not a failed send. Sending and running are one
       * promise to callers, so a provider error or a rate limit rejects it long after the review reached the
       * transcript: restoring then offered the agent's own copy back for a second submission, and reported
       * that it could not be sent.
       */
      if (wasMessageDelivered(error)) return
      logger.warn('Restoring the pending review because the send failed', {
        error: String(error),
      })
      state.restoreReview(reviewKey, pending.comments, pending.summary)
      const gainedSessionId =
        reviewKey === draftKey &&
        latestDraftKey.current === draftKey &&
        latestReviewKey.current !== reviewKey
      if (gainedSessionId) state.migrateReview(reviewKey, latestReviewKey.current)
      onReviewSendFailed?.(error)
    }
  }

  return {
    comments,
    summary,
    activeCommentLocation: thread.activeCommentLocation,
    onAddSingleComment,
    onAddToReview,
    onSetActiveComment: (location: ReviewCommentLocation | null) =>
      setActiveCommentLocation(reviewKey, location),
    onRemoveComment: (id: string) => removeComment(reviewKey, id),
    onSetSummary: (next: string) => setSummary(reviewKey, next),
    onSubmitReview,
    onDiscardReview: () => discardReview(reviewKey),
  }
}
