import { Gauge } from 'lucide-react'
import { useChat } from '@/hooks/useChat'
import { useChatStore } from '@/stores/chat-store'
import { useContextStore } from '@/stores/context-store'
import { CompactionHistorySection } from './CompactionHistorySection'
import { ContextOverview } from './ContextOverview'
import { ModelCompatibilitySection } from './ModelCompatibilitySection'
import { PinnedContextSection } from './PinnedContextSection'
import { WaggleContextSection } from './WaggleContextSection'

export function ContextInspector() {
  const conversationId = useChatStore((s) => s.activeConversationId)
  const snapshot = useContextStore((s) => s.snapshot)
  const isCompacting = useContextStore((s) => s.isCompacting)
  const { activeConversation } = useChat()
  const messages = activeConversation?.messages ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Gauge className="h-3.5 w-3.5 text-text-muted" />
        <h2 className="text-[13px] font-medium text-text-secondary tracking-tight">Context</h2>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <ContextOverview
          snapshot={snapshot}
          isCompacting={isCompacting}
          conversationId={conversationId ?? null}
        />

        {conversationId && (
          <>
            <PinnedContextSection conversationId={conversationId} />
            <ModelCompatibilitySection conversationId={conversationId} />
            <CompactionHistorySection messages={messages} />
            <WaggleContextSection activeWaggle={snapshot?.waggle ?? null} messages={messages} />
          </>
        )}
      </div>
    </div>
  )
}
