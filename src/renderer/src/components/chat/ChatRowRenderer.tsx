import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import { chooseBy } from '@shared/utils/decision'
import { Spinner } from '@/components/shared/Spinner'
import { TurnDivider } from '@/components/waggle/TurnDivider'
import { formatElapsed } from '@/hooks/useStreamingPhase'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import { CompactionEventRow } from './CompactionEventRow'
import { MessageBubble } from './MessageBubble'
import { RunSummary } from './RunSummary'
import type { ChatRow } from './types-chat-row'

interface ChatRowRendererProps {
  row: ChatRow
  conversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  onRespondToPlan?: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onDismissError: (message: string) => void
}

export function ChatRowRenderer({
  row,
  conversationId,
  onAnswerQuestion,
  onRespondToPlan,
  onOpenSettings,
  onRetry,
  onDismissError,
}: ChatRowRendererProps) {
  return chooseBy(row, 'type')
    .case('message', (value) => (
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
          onAnswerQuestion={onAnswerQuestion}
          onRespondToPlan={onRespondToPlan}
          waggle={value.waggle}
        />
      </div>
    ))
    .case('segment', (value) => (
      <div className="flex flex-col gap-6">
        {value.showDivider && value.dividerProps && (
          <TurnDivider
            turnNumber={value.dividerProps.turnNumber}
            agentLabel={value.dividerProps.agentLabel}
            agentColor={value.dividerProps.agentColor}
            isSynthesis={value.dividerProps.isSynthesis}
          />
        )}
        <MessageBubble
          message={{
            ...value.parentMessage,
            id: value.segment.id,
            parts: value.segment.parts,
          }}
          isStreaming={value.isStreaming}
          isRunActive={value.isRunActive}
          assistantModel={value.assistantModel}
          conversationId={conversationId}
          onAnswerQuestion={onAnswerQuestion}
          onRespondToPlan={onRespondToPlan}
          waggle={value.waggle}
        />
      </div>
    ))
    .case('phase-indicator', (value) => (
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
    .case('run-summary', (value) => <RunSummary phases={value.phases} totalMs={value.totalMs} />)
    .case('compaction-event', (value) => <CompactionEventRow data={value.data} />)
    .case('error', (value) => (
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
    .assertComplete()
}
