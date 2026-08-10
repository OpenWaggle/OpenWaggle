import type { ReviewComment } from '@shared/types/review'
import { useReviewStore } from '@/features/diff-panel/state/review-store'

function lineRefLabel(startLine: number, endLine: number) {
  return startLine !== endLine
    ? `s ${String(startLine)}-${String(endLine)}`
    : ` ${String(startLine)}`
}

/** Review-comment actions for the diff panel: single-comment send, batch review, and staging. */
export function useDiffReviewActions(onSendMessage: (content: string) => void) {
  const comments = useReviewStore((s) => s.comments)
  const addComment = useReviewStore((s) => s.addComment)
  const clearComments = useReviewStore((s) => s.clearComments)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)

  function onAddSingleComment(
    filePath: string,
    startLine: number,
    endLine: number,
    content: string,
  ) {
    const label = lineRefLabel(startLine, endLine)
    onSendMessage(`**Review comment** on \`${filePath}\` (line${label}):\n\n${content}`)
    setActiveCommentLocation(null)
  }

  function onSendReview() {
    if (comments.length === 0) return
    const lines = comments.map(
      (c) => `- **\`${c.filePath}\`** line${lineRefLabel(c.startLine, c.endLine)}: ${c.content}`,
    )
    onSendMessage(`**Code Review**\n\n${lines.join('\n')}`)
    clearComments()
  }

  return {
    onAddSingleComment,
    onAddToReview: (comment: ReviewComment) => addComment(comment),
    onSendReview,
  }
}
