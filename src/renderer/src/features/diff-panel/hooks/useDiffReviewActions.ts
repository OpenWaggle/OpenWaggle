import type { GitFileDiff } from '@shared/types/git'
import { createdSessionIdOf, wasMessageDelivered } from '@/features/chat/lib'
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
  /** This panel's key for a given session, in the scope the review was written in. */
  keyForSession: (sessionId: string) => string,
  onReviewSendFailed?: (error: unknown) => void,
) {
  const thread = useReviewStore((s) => selectReviewThread(s, reviewKey))
  const comments = thread.comments
  const summary = thread.summary
  const addComment = useReviewStore((s) => s.addComment)
  const removeComment = useReviewStore((s) => s.removeComment)
  const setSummary = useReviewStore((s) => s.setSummary)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)
  const discardReview = useReviewStore((s) => s.discardReview)

  async function onAddSingleComment(location: ReviewCommentLocation, content: string) {
    const comment = buildComment(files, location, content)
    setActiveCommentLocation(reviewKey, null)
    try {
      await onSendMessage(formatSingleReviewComment(comment))
    } catch (error) {
      /*
       * Kept, not dropped. This was dispatched without awaiting, so a refused send - a session whose worktree
       * has gone is the everyday one - took the comment with it and said nothing. Putting it in the pending
       * review means the reviewer still has what they wrote and can submit or discard it deliberately.
       */
      logger.warn('Keeping a single comment because the send failed', { error: String(error) })
      addComment(reviewKey, comment)
      onReviewSendFailed?.(error)
    }
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
      /*
       * A first send creates the session that carries the review, which changes where the panel looks for it.
       * The target is taken from the failure rather than from what the panel happens to show: the scope
       * selection resets for a brand-new session key, and in local mode every session of a project shares one
       * working path, so inferring it filed reviews into the wrong scope and into other sessions.
       */
      const createdSessionId = createdSessionIdOf(error)
      if (createdSessionId !== null) {
        state.migrateReview(reviewKey, keyForSession(createdSessionId))
      }
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
