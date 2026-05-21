import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
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
    <div className="flex flex-col gap-2 w-full bg-diff-header-bg py-2 px-3 border-y border-border">
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
