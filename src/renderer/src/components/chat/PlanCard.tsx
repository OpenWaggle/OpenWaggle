import { safeDecodeUnknown } from '@shared/schema'
import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'
import { planResponseSchema } from '@shared/types/plan'
import { Check, ClipboardList, Pencil } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { StreamingText } from './StreamingText'

interface PlanCardProps {
  planText: string
  conversationId: ConversationId
  result?: { content: unknown; state: string }
  isStreaming?: boolean
  onRespond: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
}

function parseHistoricalResponse(content: unknown): PlanResponse | null {
  try {
    const raw: unknown = typeof content === 'string' ? JSON.parse(content) : content
    const parsed = safeDecodeUnknown(planResponseSchema, raw)
    if (parsed.success) {
      return parsed.data
    }
  } catch {}
  return null
}

export function PlanCard({
  planText,
  conversationId,
  result,
  isStreaming,
  onRespond,
}: PlanCardProps): React.JSX.Element {
  const [feedback, setFeedback] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submittedAction, setSubmittedAction] = useState<'approve' | 'revise' | null>(null)

  const isAnswered = !!result || submitted

  // Parse historical response for rehydrated conversations
  const historicalResponse = result ? parseHistoricalResponse(result.content) : null
  const displayAction = historicalResponse?.action ?? submittedAction

  function handleApprove(): void {
    if (isAnswered) return
    setSubmitted(true)
    setSubmittedAction('approve')
    void onRespond(conversationId, { action: 'approve' })
  }

  function handleRevise(): void {
    if (isAnswered || !feedback.trim()) return
    setSubmitted(true)
    setSubmittedAction('revise')
    void onRespond(conversationId, { action: 'revise', feedback: feedback.trim() })
  }

  // Answered state — compact summary
  if (isAnswered && !isStreaming) {
    return (
      <div className="rounded-lg border border-border-light bg-bg-secondary overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border">
          <ClipboardList className="h-3.5 w-3.5 text-accent" />
          <span className="text-[13px] font-medium text-text-secondary">Plan</span>
          <span
            className={cn(
              'ml-auto inline-flex items-center gap-1 text-[12px]',
              displayAction === 'approve' ? 'text-success' : 'text-accent',
            )}
          >
            {displayAction === 'approve' ? (
              <>
                <Check className="h-3 w-3" /> Approved
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" /> Revised
              </>
            )}
          </span>
        </div>
        <div className="px-3.5 py-2.5 max-h-[200px] overflow-y-auto">
          <StreamingText text={planText} />
        </div>
        {displayAction === 'revise' && historicalResponse?.action === 'revise' && (
          <div className="border-t border-border px-3.5 py-2">
            <div className="text-[12px] text-text-tertiary">Feedback:</div>
            <div className="text-[13px] text-text-secondary mt-0.5">
              {historicalResponse.feedback}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Active state — show plan with controls
  return (
    <div className="rounded-lg border border-accent/30 bg-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border">
        <ClipboardList className="h-3.5 w-3.5 text-accent" />
        <span className="text-[13px] font-medium text-text-secondary">
          {isStreaming ? 'Planning...' : 'Plan proposed'}
        </span>
      </div>

      {/* Plan content */}
      <div className="px-3.5 py-3 max-h-[400px] overflow-y-auto">
        <StreamingText text={planText} />
      </div>

      {/* Controls — only show when not streaming */}
      {!isStreaming && (
        <div className="border-t border-border px-3.5 py-2.5 space-y-2">
          {/* Feedback input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && feedback.trim()) handleRevise()
              }}
              placeholder="Suggest changes..."
              className="flex-1 rounded-md border border-border-light bg-bg px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none transition-colors"
            />
            <button
              type="button"
              disabled={!feedback.trim()}
              onClick={handleRevise}
              className="flex items-center gap-1 rounded-md border border-border-light px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-bg-hover disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <Pencil className="h-3 w-3" />
              Revise
            </button>
          </div>

          {/* Approve button */}
          <button
            type="button"
            onClick={handleApprove}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent/25 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Implement Plan
          </button>
        </div>
      )}
    </div>
  )
}
