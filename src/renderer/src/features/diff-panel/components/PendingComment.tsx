import { MessageSquare, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload'
import { formatLineRange } from '@/features/diff-panel/lib/review-comment-payload'
import { Button } from '@/shared/ui/Button'

interface PendingCommentProps {
  readonly comment: ReviewCommentWithSnippet
  readonly onRemove: () => void
}

const COMMENT_WIDTH_STYLE: CSSProperties & { '--diff-comment-width': string } = {
  '--diff-comment-width': 'min(40rem, calc(100cqw - 4rem))',
}

/**
 * A saved-but-unsent Review comment, shown inline where it is anchored. Marked
 * "Pending" so it is obvious the agent has not received it yet -- the same signal
 * GitLab gives while a review is in progress.
 */
export function PendingComment({ comment, onRemove }: PendingCommentProps) {
  return (
    <div
      className="sticky left-0 flex w-(--diff-comment-width) flex-col gap-1.5 border-y border-border bg-diff-header-bg px-3 py-2"
      style={COMMENT_WIDTH_STYLE}
    >
      <div className="flex items-center gap-1.5">
        <MessageSquare className="size-3 shrink-0 text-text-tertiary" />
        <span className="text-xs text-text-tertiary">
          {formatLineRange(comment.startLine, comment.endLine)}
        </span>
        <span className="rounded-sm bg-bg-tertiary px-1 text-xs font-medium text-accent">
          Pending
        </span>
        <Button
          variant="unstyled"
          type="button"
          onClick={onRemove}
          aria-label="Remove comment"
          className="ml-auto flex size-4 items-center justify-center rounded-sm text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <X className="size-3" />
        </Button>
      </div>
      <p className="whitespace-pre-wrap text-xs text-text-secondary">{comment.content}</p>
    </div>
  )
}
