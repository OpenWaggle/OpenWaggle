import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'

interface ReviewBarProps {
  readonly commentCount: number
  readonly summary: string
  readonly onSummaryChange: (summary: string) => void
  readonly onSubmit: () => void | Promise<void>
  readonly onDiscard: () => void
}

/**
 * Docked review bar, modelled on GitLab's floating one but scoped to the panel:
 * the diff lives in the right sidebar, so a viewport-pinned bar would overhang
 * the transcript and composer.
 *
 * Absent until a Review is in progress, so a diff you are only reading carries no
 * extra chrome.
 */
const TEXTAREA_ROWS = 3

export function ReviewBar({
  commentCount,
  summary,
  onSummaryChange,
  onSubmit,
  onDiscard,
}: ReviewBarProps) {
  const [isSubmitOpen, setIsSubmitOpen] = useState(false)

  if (commentCount === 0) return null

  const commentLabel = `${String(commentCount)} pending comment${commentCount === 1 ? '' : 's'}`

  return (
    <div className="relative shrink-0 border-t border-accent/30 bg-diff-highlight-bg">
      {isSubmitOpen ? (
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
          <label htmlFor="review-summary" className="text-xs font-medium text-text-secondary">
            Overall instructions <span className="text-text-muted">(optional)</span>
          </label>
          <Textarea
            id="review-summary"
            autoFocus
            value={summary}
            onChange={(event) => onSummaryChange(event.target.value)}
            placeholder="Frame the review for the agent — e.g. “these all need tests first”"
            rows={TEXTAREA_ROWS}
            className="text-xs"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setIsSubmitOpen(false)
                return
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                setIsSubmitOpen(false)
                void onSubmit()
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="unstyled"
              type="button"
              onClick={() => setIsSubmitOpen(false)}
              className="h-6.5 rounded-md px-2 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              Back
            </Button>
            <Button
              variant="unstyled"
              type="button"
              onClick={() => {
                setIsSubmitOpen(false)
                void onSubmit()
              }}
              className="flex h-6.5 items-center gap-1.5 rounded-md border border-accent bg-diff-stage-bg px-2.5 text-xs font-medium text-accent"
            >
              <Send className="size-3" />
              Send to agent · {commentLabel}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex h-10 items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="size-3.5 text-accent" />
          <span className="text-xs font-medium text-text-primary">{commentLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="unstyled"
            type="button"
            onClick={onDiscard}
            className="flex h-6.5 items-center gap-1 rounded-md px-2 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <Trash2 className="size-3" />
            Discard review
          </Button>
          <Button
            variant="unstyled"
            type="button"
            onClick={() => setIsSubmitOpen((open) => !open)}
            aria-expanded={isSubmitOpen}
            className="flex h-6.5 items-center gap-1.5 rounded-md border border-accent bg-diff-stage-bg px-3 text-xs font-medium text-accent"
          >
            <Send className="size-3" />
            Submit review
          </Button>
        </div>
      </div>
    </div>
  )
}
