import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionBranchId, SessionId } from '@shared/types/brand'
import { formatElapsed } from '@/features/chat/hooks/useStreamingPhase'
import { TurnDivider } from '@/features/waggle/components'
import { AGENT_BORDER_LEFT } from '@/features/waggle/lib'
import { cn } from '@/shared/lib/cn'
import { Spinner } from '@/shared/ui/Spinner'
import type { ChatRow } from '../lib/types-chat-row'
import { BranchSummaryCard } from './BranchSummaryCard'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import { CompactionSummaryCard } from './CompactionSummaryCard'
import { InterruptedRunNotice } from './InterruptedRunNotice'
import { MessageBubble } from './MessageBubble'
import { RunSummary } from './RunSummary'

interface ChatRowRendererProps {
  row: ChatRow
  sessionId: SessionId | null
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onDismissError: (message: string) => void
  onDismissInterruptedRun?: (runId: string, branchId: SessionBranchId) => void
  onBranchFromMessage?: (messageId: string) => void
  onForkFromMessage?: (messageId: string) => void
}

export function ChatRowRenderer({
  row,
  sessionId,
  onOpenSettings,
  onRetry,
  onDismissError,
  onDismissInterruptedRun,
  onBranchFromMessage,
  onForkFromMessage,
}: ChatRowRendererProps) {
  return matchBy(row, 'type')
    .with('interrupted-run', (value) => (
      <InterruptedRunNotice
        runId={value.runId}
        branchId={value.branchId}
        runMode={value.runMode}
        model={value.model}
        interruptedAt={value.interruptedAt}
        onDismiss={onDismissInterruptedRun}
      />
    ))
    .with('message', (value) => (
      <div className="flex flex-col gap-6">
        {value.showTurnDivider && value.turnDividerProps && (
          <TurnDivider
            turnNumber={value.turnDividerProps.turnNumber}
            agentLabel={value.turnDividerProps.agentLabel}
            agentColor={value.turnDividerProps.agentColor}
            agentModel={value.turnDividerProps.agentModel}
          />
        )}
        <MessageBubble
          message={value.message}
          sessionId={sessionId}
          waggle={value.waggle}
          run={{
            isStreaming: value.isStreaming,
            isRunActive: value.isRunActive,
            assistantModel: value.assistantModel,
          }}
          actions={{ onBranchFromMessage, onForkFromMessage }}
        />
      </div>
    ))
    .with('waggle-turn', (value) => (
      <section className="flex flex-col gap-3" data-waggle-turn={value.id}>
        <TurnDivider
          turnNumber={value.turnDividerProps.turnNumber}
          agentLabel={value.turnDividerProps.agentLabel}
          agentColor={value.turnDividerProps.agentColor}
          agentModel={value.turnDividerProps.agentModel}
        />
        <div
          className={cn('flex flex-col gap-5 border-l-2 pl-4', AGENT_BORDER_LEFT[value.agentColor])}
        >
          {value.messages.map((messageRow) => (
            <MessageBubble
              key={messageRow.message.id}
              message={messageRow.message}
              sessionId={sessionId}
              waggle={messageRow.waggle}
              run={{
                isStreaming: messageRow.isStreaming,
                isRunActive: messageRow.isRunActive,
                assistantModel: messageRow.assistantModel,
              }}
              presentation={{ hideAgentLabel: true }}
              actions={{ onBranchFromMessage, onForkFromMessage }}
            />
          ))}
        </div>
      </section>
    ))
    .with('branch-summary', (value) => (
      <BranchSummaryCard
        id={value.id}
        summary={value.summary}
        onBranchFromMessage={onBranchFromMessage}
      />
    ))
    .with('compaction-summary', (value) => (
      <CompactionSummaryCard
        id={value.id}
        summary={value.summary}
        tokensBefore={value.tokensBefore}
        onBranchFromMessage={onBranchFromMessage}
      />
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
        sessionId={value.sessionId}
        onDismiss={onDismissError}
        onOpenSettings={onOpenSettings}
        onRetry={onRetry}
      />
    ))
    .exhaustive()
}
