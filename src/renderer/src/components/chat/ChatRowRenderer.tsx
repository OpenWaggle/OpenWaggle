import { matchBy } from '@diegogbrisa/ts-match'
import type { ConversationId } from '@shared/types/brand'
import { Spinner } from '@/components/shared/Spinner'
import { TurnDivider } from '@/components/waggle/TurnDivider'
import { formatElapsed } from '@/hooks/useStreamingPhase'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import { CompactionSummaryCard } from './CompactionSummaryCard'
import { MessageBubble } from './MessageBubble'
import { RunSummary } from './RunSummary'
import type { ChatRow } from './types-chat-row'

interface ChatRowRendererProps {
  row: ChatRow
  conversationId: ConversationId | null
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onDismissError: (message: string) => void
  onBranchFromMessage?: (messageId: string) => void
}

export function ChatRowRenderer({
  row,
  conversationId,
  onOpenSettings,
  onRetry,
  onDismissError,
  onBranchFromMessage,
}: ChatRowRendererProps) {
  return matchBy(row, 'type')
    .with('message', (value) => (
      <div className="flex flex-col gap-6">
        {value.showTurnDivider && value.turnDividerProps && (
          <TurnDivider
            turnNumber={value.turnDividerProps.turnNumber}
            agentLabel={value.turnDividerProps.agentLabel}
            agentColor={value.turnDividerProps.agentColor}
            isSynthesis={value.turnDividerProps.isSynthesis}
          />
        )}
        <MessageBubble
          message={value.message}
          isStreaming={value.isStreaming}
          isRunActive={value.isRunActive}
          assistantModel={value.assistantModel}
          conversationId={conversationId}
          waggle={value.waggle}
          onBranchFromMessage={onBranchFromMessage}
        />
      </div>
    ))
    .with('compaction-summary', (value) => (
      <CompactionSummaryCard summary={value.summary} tokensBefore={value.tokensBefore} />
    ))
    .with('phase-indicator', (value) => (
      <div className="flex items-center gap-2 py-3">
        <Spinner size="sm" className="text-accent" />
        <span className="text-sm text-text-tertiary">{value.label}...</span>
        {value.elapsedMs > 0 ? (
          <span className="text-sm text-text-muted tabular-nums">
            {formatElapsed(value.elapsedMs)}
          </span>
        ) : null}
      </div>
    ))
    .with('run-summary', (value) => <RunSummary phases={value.phases} totalMs={value.totalMs} />)
    .with('error', (value) => (
      <ChatErrorDisplay
        error={value.error}
        lastUserMessage={value.lastUserMessage}
        dismissedError={value.dismissedError}
        conversationId={value.conversationId}
        onDismiss={onDismissError}
        onOpenSettings={onOpenSettings}
        onRetry={onRetry}
      />
    ))
    .exhaustive()
}
