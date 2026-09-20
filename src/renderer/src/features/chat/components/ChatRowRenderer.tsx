import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { TurnDivider } from '@/features/waggle/components'
import { AGENT_BORDER_LEFT } from '@/features/waggle/lib'
import { cn } from '@/shared/lib/cn'
import { latestTurnIndex } from '../lib/changed-files-presentation'
import type { ChatRow, MessageChatRow, WaggleTurnChatRow } from '../lib/types-chat-row'
import { CustomMessageRow } from './AgentLoopCustomMessageRow'
import { InteractionEventRow } from './AgentLoopInteractionEventRow'
import { StatusRow } from './AgentLoopStatusRow'
import { BranchSummaryCard } from './BranchSummaryCard'
import { ChangedFilesCard } from './ChangedFilesCard'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { CompactionTimelineRow } from './CompactionTimelineRow'
import { MessageBubble } from './MessageBubble'
import { TurnFoldRow } from './TurnFoldRow'
import { WorktreeLaunchRow } from './WorktreeLaunchRow'

interface ChatRowRendererProps {
  row: ChatRow
  context?: ChatRowRenderContext
  sessionId?: SessionId | null
  extensionRegistry?: ExtensionContributionRegistryView | null
  extensionProjectPaths?: readonly string[]
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onDismissError?: (message: string) => void
  onBranchFromMessage?: (messageId: string) => void
  onForkFromMessage?: (messageId: string) => void
  onToggleTurnFold?: (turnKey: string) => void
}

function fallbackContext(props: ChatRowRendererProps): ChatRowRenderContext {
  const extensions = {
    registry: props.extensionRegistry ?? null,
    projectPaths: props.extensionProjectPaths ?? [],
  }
  return {
    runtime: { sessionId: props.sessionId ?? null, extensions },
    extensions,
    turnsByAnchorNodeId: new Map(),
    actions: {
      onBranchFromMessage: props.onBranchFromMessage,
      onForkFromMessage: props.onForkFromMessage,
      onToggleTurnFold: props.onToggleTurnFold,
    },
    onOpenSettings: props.onOpenSettings,
    onRetry: props.onRetry,
    onDismissError: props.onDismissError ?? (() => undefined),
  }
}

function MessageRow({
  row,
  context,
}: {
  readonly row: MessageChatRow
  readonly context: ChatRowRenderContext
}) {
  const turn = row.isRunActive ? undefined : context.turnsByAnchorNodeId.get(row.message.id)
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
        presentation={{ turnFolded: row.turnPresentation === 'folded' }}
        actions={context.actions}
      />
      {turn && context.actions.onOpenTurnDiff ? (
        <ChangedFilesCard
          sessionId={context.runtime.sessionId}
          turn={turn}
          isLatestTurn={turn.turnIndex === latestTurnIndex(context.turnsByAnchorNodeId)}
          anchorMessageId={row.message.id}
          onOpenTurnDiff={context.actions.onOpenTurnDiff}
        />
      ) : null}
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
  // ADR 0033: every settled turn with a Turn diff renders a changed-files card,
  // including waggle agent turns (checkpoint anchors the run's terminal node).
  const terminalMessageId = row.folded
    ? row.messages.find((messageRow) => messageRow.turnPresentation === 'folded')?.message.id
    : undefined
  const turn = terminalMessageId ? context.turnsByAnchorNodeId.get(terminalMessageId) : undefined
  return (
    <section className="flex flex-col gap-3" data-waggle-turn={row.id}>
      <TurnDivider
        turnNumber={row.turnDividerProps.turnNumber}
        agentLabel={row.turnDividerProps.agentLabel}
        agentColor={row.turnDividerProps.agentColor}
        agentModel={row.turnDividerProps.agentModel}
      />
      <div className={cn('flex flex-col gap-5 border-l-2 pl-4', AGENT_BORDER_LEFT[row.agentColor])}>
        {row.foldRow && context.actions.onToggleTurnFold ? (
          <TurnFoldRow
            row={row.foldRow}
            sessionId={context.runtime.sessionId}
            extensions={context.extensions}
            onToggleTurnFold={context.actions.onToggleTurnFold}
          />
        ) : null}
        {(row.folded
          ? row.messages.filter((messageRow) => messageRow.turnPresentation === 'folded')
          : row.messages
        ).map((messageRow) => (
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
            presentation={{
              hideAgentLabel: true,
              turnFolded: messageRow.turnPresentation === 'folded',
            }}
            actions={context.actions}
          />
        ))}
        {turn && terminalMessageId && context.actions.onOpenTurnDiff ? (
          <ChangedFilesCard
            sessionId={context.runtime.sessionId}
            turn={turn}
            isLatestTurn={turn.turnIndex === latestTurnIndex(context.turnsByAnchorNodeId)}
            anchorMessageId={terminalMessageId}
            onOpenTurnDiff={context.actions.onOpenTurnDiff}
          />
        ) : null}
      </div>
    </section>
  )
}

export function ChatRowRenderer(props: ChatRowRendererProps) {
  const context = props.context ?? fallbackContext(props)
  return matchBy(props.row, 'type')
    .with('message', (row) => <MessageRow row={row} context={context} />)
    .with('turn-fold', (row) =>
      context.actions.onToggleTurnFold ? (
        <TurnFoldRow
          row={row}
          sessionId={context.runtime.sessionId}
          extensions={context.extensions}
          onToggleTurnFold={context.actions.onToggleTurnFold}
        />
      ) : null,
    )
    .with('worktree-launch', (row) => (
      <WorktreeLaunchRow launch={row.launch} sessionId={row.sessionId} />
    ))
    .with('waggle-turn', (row) => <WaggleTurnRow row={row} context={context} />)
    .with('branch-summary', (row) => (
      <BranchSummaryCard
        id={row.id}
        summary={row.summary}
        onBranchFromMessage={context.actions.onBranchFromMessage}
      />
    ))
    .with('compaction-summary', (row) => (
      <CompactionTimelineRow
        accessible
        state={
          row.reason === 'threshold' || row.reason === 'overflow'
            ? 'automatic-complete'
            : row.reason === 'manual'
              ? 'manual-complete'
              : 'legacy-complete'
        }
      />
    ))
    .with('compaction-status', (row) => <CompactionTimelineRow state={row.state} />)
    .with('agent-loop-custom-message', (row) => (
      <CustomMessageRow row={row} extensions={context.extensions} />
    ))
    .with('phase-indicator', (row) => <StatusRow row={row} extensions={context.extensions} />)
    .with('agent-loop-interaction', (row) => (
      <InteractionEventRow item={row.item} extensions={context.extensions} />
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
