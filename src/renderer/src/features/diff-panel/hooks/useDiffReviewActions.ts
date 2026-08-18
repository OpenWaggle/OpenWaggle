import type { GitFileDiff } from '@shared/types/git'
import {
  extractDiffSnippet,
  formatReviewSubmission,
  formatSingleReviewComment,
  type ReviewCommentWithSnippet,
} from '@/features/diff-panel/lib/review-comment-payload'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { selectReviewThread, useReviewStore } from '@/features/diff-panel/state/review-store'

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
  onSendMessage: (content: string) => void,
  files: readonly GitFileDiff[],
  reviewKey: string,
) {
  const thread = useReviewStore((s) => selectReviewThread(s, reviewKey))
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

  function onSubmitReview() {
    // Read imperatively rather than from the render closure. `comments` here is the
    // value from the last render, so a rapid double-click (or a key repeat on the
    // Cmd+Enter shortcut) fires this twice before React re-renders with the cleared
    // array: both calls pass the emptiness guard and the agent receives the same
    // review twice.
    const state = useReviewStore.getState()
    const pending = selectReviewThread(state, reviewKey)
    if (pending.comments.length === 0) return
    onSendMessage(formatReviewSubmission(pending.summary, pending.comments))
    state.clearComments(reviewKey)
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
