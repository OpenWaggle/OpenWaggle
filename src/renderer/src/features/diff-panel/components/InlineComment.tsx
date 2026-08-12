import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { formatLineRange } from '@/features/diff-panel/lib/review-comment-payload'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'

interface InlineCommentProps {
  readonly startLine: number
  readonly endLine: number
  /** Once a Review is open, the batch action reads "Add to review" (GitLab). */
  readonly hasPendingReview: boolean
  readonly onAddSingleComment: (content: string) => void
  readonly onAddToReview: (content: string) => void
  readonly onCancel: () => void
}

/**
 * Composer for a new Review comment, mounted in the renderer's annotation slot.
 *
 * Width is bounded in container-query units against the diff's VISIBLE width:
 * the code column is as wide as its longest line, so a full-width comment would
 * push its own actions off-screen.
 */
const TEXTAREA_ROWS = 3

export function InlineComment({
  startLine,
  endLine,
  hasPendingReview,
  onAddSingleComment,
  onAddToReview,
  onCancel,
}: InlineCommentProps) {
  const [content, setContent] = useState('')
  const trimmed = content.trim()
  const canSubmit = trimmed !== ''

  function handleAddSingle() {
    if (!canSubmit) return
    onAddSingleComment(trimmed)
    setContent('')
  }

  function handleAddToReview() {
    if (!canSubmit) return
    onAddToReview(trimmed)
    setContent('')
  }

  return (
    <div className="flex w-[min(640px,100cqw)] flex-col gap-2 border-y border-border bg-diff-header-bg px-3 py-2">
      <div className="flex items-center gap-1.5">
        <MessageSquare className="size-3 shrink-0 text-text-tertiary" />
        <span className="text-[11px] text-text-tertiary">
          Comment on {formatLineRange(startLine, endLine)}
        </span>
      </div>

      <Textarea
        autoFocus
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Leave feedback on this change…"
        rows={TEXTAREA_ROWS}
        className="text-[12px]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
            return
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            if (hasPendingReview) handleAddToReview()
            else handleAddSingle()
          }
        }}
      />

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="unstyled"
          type="button"
          onClick={onCancel}
          className="h-[26px] rounded-[5px] px-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          Cancel
        </Button>
        <Button
          variant="unstyled"
          type="button"
          onClick={handleAddSingle}
          disabled={!canSubmit}
          className="h-[26px] rounded-[5px] border border-button-border px-2.5 text-[12px] text-text-secondary transition-opacity hover:bg-bg-hover disabled:opacity-40"
        >
          Add comment
        </Button>
        <Button
          variant="unstyled"
          type="button"
          onClick={handleAddToReview}
          disabled={!canSubmit}
          className="h-[26px] rounded-[5px] border border-accent bg-diff-stage-bg px-2.5 text-[12px] font-medium text-accent transition-opacity disabled:opacity-40"
        >
          {hasPendingReview ? 'Add to review' : 'Start a review'}
        </Button>
      </div>
    </div>
  )
}
