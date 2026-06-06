import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionBranchId, SessionId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { TurnDivider } from '@/features/waggle/components'
import { AGENT_BORDER_LEFT } from '@/features/waggle/lib'
import { cn } from '@/shared/lib/cn'
import type { ChatRow, MessageChatRow, WaggleTurnChatRow } from '../lib/types-chat-row'
import { CustomMessageRow, InteractionEventRow, StatusRow } from './AgentLoopChatRows'
import { BranchSummaryCard } from './BranchSummaryCard'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { CompactionSummaryCard } from './CompactionSummaryCard'
import { InterruptedRunNotice } from './InterruptedRunNotice'
import { MessageBubble } from './MessageBubble'

interface ChatRowRendererProps {
  row: ChatRow
  context?: ChatRowRenderContext
  sessionId?: SessionId | null
  extensionRegistry?: ExtensionContributionRegistryView | null
  extensionProjectPaths?: readonly string[]
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onDismissError?: (message: string) => void
  onDismissInterruptedRun?: (runId: string, branchId: SessionBranchId) => void
  onBranchFromMessage?: (messageId: string) => void
  onForkFromMessage?: (messageId: string) => void
}

function fallbackContext(props: ChatRowRendererProps): ChatRowRenderContext {
  const extensions = {
    registry: props.extensionRegistry ?? null,
    projectPaths: props.extensionProjectPaths ?? [],
  }
  return {
    runtime: { sessionId: props.sessionId ?? null, extensions },
    extensions,
    actions: {
      onBranchFromMessage: props.onBranchFromMessage,
      onForkFromMessage: props.onForkFromMessage,
    },
    onOpenSettings: props.onOpenSettings,
    onRetry: props.onRetry,
    onDismissError: props.onDismissError ?? (() => undefined),
    onDismissInterruptedRun: props.onDismissInterruptedRun,
  }
}

function MessageRow({
  row,
  context,
}: {
  readonly row: MessageChatRow
  readonly context: ChatRowRenderContext
}) {
  return (
    <div className="flex flex-col gap-6">
      {row.showTurnDivider && row.turnDividerProps && (
        <TurnDivider
          turnNumber={row.turnDividerProps.turnNumber}
          agentLabel={row.turnDividerProps.agentLabel}
          agentColor={row.turnDividerProps.agentColor}
          agentModel={row.turnDividerProps.agentModel}
        />
      )}
      <MessageBubble
        message={row.message}
        runtime={context.runtime}
        waggle={row.waggle}
        run={{
          isStreaming: row.isStreaming,
          isRunActive: row.isRunActive,
          assistantModel: row.assistantModel,
        }}
        actions={context.actions}
      />
    </div>
  )
}

function WaggleTurnRow({
  row,
  context,
}: {
  readonly row: WaggleTurnChatRow
  readonly context: ChatRowRenderContext
}) {
  return (
    <section className="flex flex-col gap-3" data-waggle-turn={row.id}>
      <TurnDivider
        turnNumber={row.turnDividerProps.turnNumber}
        agentLabel={row.turnDividerProps.agentLabel}
        agentColor={row.turnDividerProps.agentColor}
        agentModel={row.turnDividerProps.agentModel}
      />
      <div className={cn('flex flex-col gap-5 border-l-2 pl-4', AGENT_BORDER_LEFT[row.agentColor])}>
        {row.messages.map((messageRow) => (
          <MessageBubble
            key={messageRow.message.id}
            message={messageRow.message}
            runtime={context.runtime}
            waggle={messageRow.waggle}
            run={{
              isStreaming: messageRow.isStreaming,
              isRunActive: messageRow.isRunActive,
              assistantModel: messageRow.assistantModel,
            }}
            presentation={{ hideAgentLabel: true }}
            actions={context.actions}
          />
        ))}
      </div>
    </section>
  )
}

export function ChatRowRenderer(props: ChatRowRendererProps) {
  const context = props.context ?? fallbackContext(props)
  return matchBy(props.row, 'type')
    .with('interrupted-run', (row) => (
      <InterruptedRunNotice
        runId={row.runId}
        branchId={row.branchId}
        runMode={row.runMode}
        model={row.model}
        interruptedAt={row.interruptedAt}
        onDismiss={context.onDismissInterruptedRun}
      />
    ))
    .with('message', (row) => <MessageRow row={row} context={context} />)
    .with('waggle-turn', (row) => <WaggleTurnRow row={row} context={context} />)
    .with('branch-summary', (row) => (
      <BranchSummaryCard
        id={row.id}
        summary={row.summary}
        onBranchFromMessage={context.actions.onBranchFromMessage}
      />
    ))
    .with('compaction-summary', (row) => (
      <CompactionSummaryCard
        id={row.id}
        summary={row.summary}
        tokensBefore={row.tokensBefore}
        onBranchFromMessage={context.actions.onBranchFromMessage}
      />
    ))
    .with('agent-loop-custom-message', (row) => (
      <CustomMessageRow row={row} extensions={context.extensions} />
    ))
    .with('phase-indicator', 'run-summary', (row) => (
      <StatusRow row={row} extensions={context.extensions} />
    ))
    .with('agent-loop-interaction-event', (row) => (
      <InteractionEventRow event={row.event} extensions={context.extensions} />
    ))
    .with('error', (row) => (
      <ChatErrorDisplay
        error={row.error}
        lastUserMessage={row.lastUserMessage}
        dismissedError={row.dismissedError}
        sessionId={row.sessionId}
        onDismiss={context.onDismissError}
        onOpenSettings={context.onOpenSettings}
        onRetry={context.onRetry}
      />
    ))
    .exhaustive()
}
