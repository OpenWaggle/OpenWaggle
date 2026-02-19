import { MessageSquare } from 'lucide-react'
import { useState } from 'react'

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
}: InlineCommentProps): React.JSX.Element {
  const [content, setContent] = useState('')

  const lineLabel = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`

  function handleAddSingle(): void {
    if (!content.trim()) return
    onAddSingleComment(content.trim())
    setContent('')
  }

  function handleAddToReview(): void {
    if (!content.trim()) return
    onAddToReview(content.trim())
    setContent('')
  }

  return (
    <div className="flex flex-col gap-2 w-full bg-diff-header-bg py-2 px-3 border-y border-border">
      {/* Comment Meta */}
      <div className="flex items-center gap-1.5 h-[18px]">
        <MessageSquare className="h-[11px] w-[11px] text-text-tertiary shrink-0" />
        <span className="text-[11px] font-medium text-text-secondary">Comment on {lineLabel}</span>
      </div>

      {/* Comment Editor */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Leave feedback on this change…"
        className="w-full h-[58px] bg-diff-bg rounded-md py-2 px-2.5 border border-button-border text-[12px] text-text-primary placeholder:text-text-tertiary font-sans resize-none focus:outline-none focus:border-accent/50"
      />

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 h-[26px]">
        <button
          type="button"
          onClick={handleAddSingle}
          disabled={!content.trim()}
          className="flex items-center h-[26px] px-2.5 rounded-[5px] bg-gradient-to-b from-accent to-accent-dim border border-accent-dim text-[11px] font-semibold text-diff-bg disabled:opacity-40 transition-opacity"
        >
          Add single comment
        </button>
        <button
          type="button"
          onClick={handleAddToReview}
          disabled={!content.trim()}
          className="flex items-center h-[26px] px-2.5 rounded-[5px] border border-button-border text-[11px] text-text-secondary disabled:opacity-40 transition-opacity"
        >
          Add to review
        </button>
      </div>
    </div>
  )
}
