import { MessageSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'

interface InlineCommentProps {
  startLine: number
  endLine: number
  onAddSingleComment: (content: string) => void
  onAddToReview: (content: string) => void
  onCancel: () => void
}

export function InlineComment({
  startLine,
  endLine,
  onAddSingleComment,
  onAddToReview,
  onCancel,
}: InlineCommentProps) {
  const [content, setContent] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // The diff body scrolls horizontally to the width of its longest line, so a
  // comment opened while scrolled right had its actions far outside the viewport
  // and could not be submitted. `position: sticky` cannot fix this: the file
  // section wrapper sets `overflow-x: hidden` (to clip children to its rounded
  // corners), which becomes the sticky scrollport and is itself unscrollable.
  // Bringing the diff back to the left edge makes the whole comment reachable.
  useEffect(() => {
    const scroller = rootRef.current?.closest('.diff-scroll')
    // scrollTo is unimplemented in jsdom, and this is a pure convenience.
    if (typeof scroller?.scrollTo === 'function') {
      scroller.scrollTo({ left: 0, behavior: 'smooth' })
    }
  }, [])

  const lineLabel = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`

  function handleAddSingle() {
    if (!content.trim()) return
    onAddSingleComment(content.trim())
    setContent('')
  }

  function handleAddToReview() {
    if (!content.trim()) return
    onAddToReview(content.trim())
    setContent('')
  }

  return (
    // Bounded width in container-query units: `w-full`/`100%` resolve against the
    // scrollable content width (the longest diff line), so the box could be
    // thousands of pixels wide with its actions off-screen. `100cqw` is the
    // VISIBLE width of `.diff-scroll`, which declares the container context.
    <div
      ref={rootRef}
      className="flex w-[min(640px,100cqw)] flex-col gap-2 border-y border-border bg-diff-header-bg px-3 py-2"
    >
      {/* Comment Meta */}
      <div className="flex items-center gap-1.5 h-[18px]">
        <MessageSquare className="size-[11px] text-text-tertiary shrink-0" />
        <span className="text-[11px] font-medium text-text-secondary">Comment on {lineLabel}</span>
      </div>

      {/* Comment Editor */}
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Leave feedback on this change…"
        resize="none"
        className="h-[58px] rounded-md border-button-border bg-diff-bg px-2.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-accent/50"
      />

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 h-[26px]">
        <Button
          variant="primary"
          size="xs"
          onClick={handleAddSingle}
          disabled={!content.trim()}
          className="h-[26px]"
        >
          Add single comment
        </Button>
        <Button
          variant="secondary"
          size="xs"
          onClick={handleAddToReview}
          disabled={!content.trim()}
          className="h-[26px]"
        >
          Add to review
        </Button>
      </div>
    </div>
  )
}
