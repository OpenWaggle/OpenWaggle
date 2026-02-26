import type { ConversationId } from '@shared/types/brand'
import type { QuestionAnswer } from '@shared/types/question'
import { TurnDivider } from '@/components/multi-agent/TurnDivider'
import { Spinner } from '@/components/shared/Spinner'
import { formatElapsed } from '@/hooks/useStreamingPhase'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import { MessageBubble } from './MessageBubble'
import { RunSummary } from './RunSummary'
import type { VirtualRow } from './types-virtual'

interface VirtualRowRendererProps {
  row: VirtualRow
  conversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onDismissError: (message: string) => void
}

export function VirtualRowRenderer({
  row,
  conversationId,
  onAnswerQuestion,
  onOpenSettings,
  onRetry,
  onDismissError,
}: VirtualRowRendererProps): React.JSX.Element {
  switch (row.type) {
    case 'message':
      return (
        <div className="flex flex-col gap-6">
          {row.showTurnDivider && row.turnDividerProps && (
            <TurnDivider
              turnNumber={row.turnDividerProps.turnNumber}
              agentLabel={row.turnDividerProps.agentLabel}
              agentColor={row.turnDividerProps.agentColor}
              isSynthesis={row.turnDividerProps.isSynthesis}
            />
          )}
          <MessageBubble
            message={row.message}
            isStreaming={row.isStreaming}
            assistantModel={row.assistantModel}
            conversationId={conversationId}
            onAnswerQuestion={onAnswerQuestion}
            multiAgent={row.multiAgent}
          />
        </div>
      )

    case 'segment':
      return (
        <div className="flex flex-col gap-6">
          {row.showDivider && row.dividerProps && (
            <TurnDivider
              turnNumber={row.dividerProps.turnNumber}
              agentLabel={row.dividerProps.agentLabel}
              agentColor={row.dividerProps.agentColor}
              isSynthesis={row.dividerProps.isSynthesis}
            />
          )}
          <MessageBubble
            message={{
              ...row.parentMessage,
              id: row.segment.id,
              parts: row.segment.parts,
            }}
            isStreaming={row.isStreaming}
            assistantModel={row.assistantModel}
            conversationId={conversationId}
            onAnswerQuestion={onAnswerQuestion}
            multiAgent={row.multiAgent}
          />
        </div>
      )

    case 'phase-indicator':
      return (
        <div className="flex items-center gap-2 py-3">
          <Spinner size="sm" className="text-accent" />
          <span className="text-sm text-text-tertiary">{row.label}...</span>
          <span className="text-sm text-text-muted tabular-nums">
            {formatElapsed(row.elapsedMs)}
          </span>
        </div>
      )

    case 'run-summary':
      return <RunSummary phases={row.phases} totalMs={row.totalMs} />

    case 'error':
      return (
        <ChatErrorDisplay
          error={row.error}
          lastUserMessage={row.lastUserMessage}
          dismissedError={row.dismissedError}
          conversationId={row.conversationId}
          onDismiss={onDismissError}
          onOpenSettings={onOpenSettings}
          onRetry={onRetry}
        />
      )
  }
}
