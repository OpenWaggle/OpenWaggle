import type { GitFileDiff } from '@shared/types/git'
import {
  extractDiffSnippet,
  formatReviewSubmission,
  formatSingleReviewComment,
  type ReviewCommentWithSnippet,
} from '@/features/diff-panel/lib/review-comment-payload'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { useReviewStore } from '@/features/diff-panel/state/review-store'

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
) {
  const comments = useReviewStore((s) => s.comments)
  const summary = useReviewStore((s) => s.summary)
  const addComment = useReviewStore((s) => s.addComment)
  const removeComment = useReviewStore((s) => s.removeComment)
  const clearComments = useReviewStore((s) => s.clearComments)
  const setSummary = useReviewStore((s) => s.setSummary)
  const discardReview = useReviewStore((s) => s.discardReview)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)

  function onAddSingleComment(location: ReviewCommentLocation, content: string) {
    onSendMessage(formatSingleReviewComment(buildComment(files, location, content)))
    setActiveCommentLocation(null)
  }

  function onAddToReview(location: ReviewCommentLocation, content: string) {
    addComment(buildComment(files, location, content))
  }

  function onSubmitReview() {
    if (comments.length === 0) return
    onSendMessage(formatReviewSubmission(summary, comments))
    clearComments()
  }

  return {
    comments,
    summary,
    onAddSingleComment,
    onAddToReview,
    onRemoveComment: removeComment,
    onSetSummary: setSummary,
    onSubmitReview,
    onDiscardReview: discardReview,
  }
}
