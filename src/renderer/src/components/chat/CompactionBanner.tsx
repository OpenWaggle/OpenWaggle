import type { ConversationId } from '@shared/types/brand'
import { AlertCircle, Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'
import { selectCompaction, useCompactionStore } from '@/stores/compaction-store'

interface CompactionBannerProps {
  readonly conversationId: ConversationId | null
}

export function CompactionBanner({ conversationId }: CompactionBannerProps) {
  const status = useCompactionStore(selectCompaction(conversationId))
  const clearStatus = useCompactionStore((s) => s.clearStatus)
  const createConversation = useChatStore((s) => s.createConversation)
  const activeProjectPath = useChatStore((s) => s.activeConversation?.projectPath) ?? null

  if (!status || !conversationId) return null

  // Capture narrowed non-null value for use in nested callbacks
  const activeConversationId = conversationId

  const isActive = status.stage === 'starting' || status.stage === 'summarizing'
  const isCompleted = status.stage === 'completed'
  const isFailed = status.stage === 'failed'

  function handleDismiss() {
    clearStatus(activeConversationId)
  }

  async function handleNewConversation() {
    await createConversation(activeProjectPath)
  }

  return (
    <output
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3.5 py-2 animate-in fade-in slide-in-from-bottom-1 duration-200',
        isActive && 'border-info/20 bg-info/5',
        isCompleted && 'border-success/20 bg-success/5',
        isFailed && 'border-error/20 bg-error/5',
      )}
    >
      {isActive && <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-info" />}
      {isCompleted && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />}
      {isFailed && <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0 text-error" />}

      <span className="flex-1 text-[13px] text-fg-2">
        {isActive && 'Compacting context\u2026'}
        {isCompleted && (
          <>
            Context compacted
            {status.metrics && (
              <span className="text-fg-3">
                {' '}
                — {status.metrics.messagesSummarized} messages summarized
              </span>
            )}
          </>
        )}
        {isFailed && (status.errorMessage ?? 'Context compaction failed')}
      </span>

      {(isCompleted || isFailed) && (
        <button
          type="button"
          onClick={() => void handleNewConversation()}
          className="shrink-0 text-[12px] text-accent hover:underline"
        >
          New conversation
        </button>
      )}

      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 text-fg-3 hover:bg-bg-2 hover:text-fg-2"
        title="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </output>
  )
}
