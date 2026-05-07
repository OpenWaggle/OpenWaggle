import type { SessionBranchId, SessionId } from '@shared/types/brand'
import { chooseBy } from '@shared/utils/decision'
import { Spinner } from '@/components/shared/Spinner'
import { TurnDivider } from '@/components/waggle/TurnDivider'
import { formatElapsed } from '@/hooks/useStreamingPhase'
import { AGENT_BORDER_LEFT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { BranchSummaryCard } from './BranchSummaryCard'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import { CompactionSummaryCard } from './CompactionSummaryCard'
import { InterruptedRunNotice } from './InterruptedRunNotice'
import { MessageBubble } from './MessageBubble'
import { RunSummary } from './RunSummary'
import type { ChatRow } from './types-chat-row'

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
  return chooseBy(row, 'type')
    .case('interrupted-run', (value) => (
      <InterruptedRunNotice
        runId={value.runId}
        branchId={value.branchId}
        runMode={value.runMode}
        model={value.model}
        interruptedAt={value.interruptedAt}
        onDismiss={onDismissInterruptedRun}
      />
    ))
    .case('message', (value) => (
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
          isStreaming={value.isStreaming}
          isRunActive={value.isRunActive}
          assistantModel={value.assistantModel}
          sessionId={sessionId}
          waggle={value.waggle}
          onBranchFromMessage={onBranchFromMessage}
          onForkFromMessage={onForkFromMessage}
        />
      </div>
    ))
    .case('waggle-turn', (value) => (
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
              isStreaming={messageRow.isStreaming}
              isRunActive={messageRow.isRunActive}
              assistantModel={messageRow.assistantModel}
              sessionId={sessionId}
              waggle={messageRow.waggle}
              hideAgentLabel
              onBranchFromMessage={onBranchFromMessage}
              onForkFromMessage={onForkFromMessage}
            />
          ))}
        </div>
      </section>
    ))
    .case('branch-summary', (value) => (
      <BranchSummaryCard
        id={value.id}
        summary={value.summary}
        onBranchFromMessage={onBranchFromMessage}
      />
    ))
    .case('compaction-summary', (value) => (
      <CompactionSummaryCard
        id={value.id}
        summary={value.summary}
        tokensBefore={value.tokensBefore}
        onBranchFromMessage={onBranchFromMessage}
      />
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
    .case('error', (value) => (
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
    .assertComplete()
}
