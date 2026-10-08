import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionInterruptedRun } from '@shared/types/session'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { StreamingPhaseState } from '@/features/chat/hooks/useStreamingPhase'
import { BEFORE_FIRST_MESSAGE, placeAgentLoopCards } from '../lib/agent-loop-card-placement'
import {
  createMessageRow,
  getSummaryRow,
  tryNestToolResultMessage,
} from '../lib/chat-message-row-model'
import { appendStatusRows } from '../lib/chat-status-row-model'
import {
  createCompactionRowAppender,
  createCompactionStatusRows,
} from '../lib/compaction-chat-row-model'
import { applyTurnFolds, type TurnFoldInput } from '../lib/turn-fold'
import type { AgentInteractionEvent, ChatRow } from '../lib/types-chat-row'
import { groupWaggleTurnRows } from '../lib/waggle-turn-rows'
import { createWorktreeLaunchRows, isWorktreeCreatedEvent } from '../lib/worktree-launch-row-model'
import type { AgentCompactionStatus } from './useAgentChat.types'

interface BuildChatRowsParams {
  messages: UIMessage[]
  customMessages?: readonly AgentTransportCustomEvent[]
  interactionEvents?: readonly AgentInteractionEvent[]
  /** The message each persisted agent-loop event follows (`readAgentLoopEventsFromWorkspace`). */
  agentLoopAnchorMessageIds?: ReadonlyMap<string, string>
  isLoading: boolean
  isFinishing?: boolean
  error: Error | undefined
  lastUserMessage: string | null
  dismissedError: string | null
  sessionId: string | null
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
  phase: StreamingPhaseState
  interruptedRun?: SessionInterruptedRun
  worktreeLaunch?: WorktreeLaunchSnapshot | null
  /** A first send is on its way to a Session that has not started running yet. */
  firstSendPending?: boolean
  compactionStatus?: AgentCompactionStatus | null
  /** Durable per-turn durations keyed by terminal assistant message id (turn checkpoints). */
  turnDurationsByAnchorMessageId?: ReadonlyMap<string, number>
  /** Turn keys the user expanded in this session (fold state is in-memory). */
  expandedTurnKeys?: ReadonlySet<string>
}

/** A first send that nothing (no launch step, no run, no reply) has answered yet. */
function isAwaitingFirstRun(params: BuildChatRowsParams, launchRows: readonly ChatRow[]) {
  return (
    params.firstSendPending === true &&
    params.interruptedRun === undefined &&
    launchRows.length === 0 &&
    !params.messages.some((message) => message.role === 'assistant')
  )
}

/** ADR 0034 fold inputs derived from the run's settled/active state. */
function appendInterruptedRunRow(rows: ChatRow[], params: BuildChatRowsParams) {
  if (!params.interruptedRun || params.isLoading) return
  rows.push({
    type: 'interrupted-run',
    runId: params.interruptedRun.runId,
    branchId: params.interruptedRun.branchId,
    runMode: params.interruptedRun.runMode,
    model: params.interruptedRun.model,
    interruptedAt: params.interruptedRun.interruptedAt,
  })
}

function toTurnFoldInput(params: BuildChatRowsParams): TurnFoldInput {
  return {
    isLoading: params.isLoading,
    // A reset phase timer (0 on session load) is "unknown", not a zero-second run.
    settledRunDurationMs:
      params.isLoading || params.phase.totalElapsedMs <= 0 ? null : params.phase.totalElapsedMs,
    turnDurationsByAnchorMessageId: params.turnDurationsByAnchorMessageId ?? new Map(),
    interrupted: !params.isLoading && params.interruptedRun !== undefined,
    expandedTurnKeys: params.expandedTurnKeys ?? new Set(),
  }
}

function placeCards(params: BuildChatRowsParams) {
  return placeAgentLoopCards({
    messages: params.messages,
    customMessages: (params.customMessages ?? []).filter((event) => !isWorktreeCreatedEvent(event)),
    interactionEvents: params.interactionEvents ?? [],
    anchorMessageIdByEventKey: params.agentLoopAnchorMessageIds,
  })
}

export function buildChatRows(params: BuildChatRowsParams): ChatRow[] {
  const rows: ChatRow[] = []
  const compactionRows = createCompactionStatusRows(
    params.compactionStatus,
    params.messages.flatMap((message) =>
      message.metadata?.compactionSummary === undefined ? [] : [message.id],
    ),
  )
  const appendCompactionRowsAt = createCompactionRowAppender(rows, compactionRows)
  const launchRows = createWorktreeLaunchRows({
    sessionId: params.sessionId,
    liveLaunch: params.worktreeLaunch,
    customMessages: params.customMessages ?? [],
  })
  let didAppendLaunchRows = false
  const appendLaunchRows = () => {
    if (didAppendLaunchRows) return
    rows.push(...launchRows)
    didAppendLaunchRows = true
  }
  const cards = placeCards(params)
  const hasPlacedCards = cards.afterMessageIndex.size > 0
  const appendCardsAfter = (index: number) => {
    if (!hasPlacedCards) return
    const placed = cards.afterMessageIndex.get(index)
    if (placed) rows.push(...placed)
  }
  const lastMessage = params.messages[params.messages.length - 1]
  const lastIsStreaming =
    params.isLoading &&
    params.compactionStatus?.type !== 'retrying' &&
    lastMessage?.role === 'assistant'
  let previousVisibleWaggleMeta: WaggleMessageMetadata | undefined

  const appendMessage = (message: UIMessage, index: number) => {
    const summaryRow = getSummaryRow(message)
    if (summaryRow) {
      rows.push(summaryRow)
      return
    }
    if (tryNestToolResultMessage(rows, message)) return

    const meta = params.waggleMetadataLookup[message.id]
    rows.push(
      createMessageRow({
        message,
        meta,
        previousVisibleWaggleMeta,
        isStreaming: lastIsStreaming && index === params.messages.length - 1,
        isLoading: params.isLoading,
      }),
    )
    if (meta && message.role === 'assistant') previousVisibleWaggleMeta = meta
  }

  appendCardsAfter(BEFORE_FIRST_MESSAGE)
  for (let index = 0; index < params.messages.length; index += 1) {
    appendCompactionRowsAt(index)
    const message = params.messages[index]
    if (message.role === 'assistant') appendLaunchRows()
    appendMessage(message, index)
    appendCardsAfter(index)
  }
  appendCompactionRowsAt(params.messages.length)

  appendLaunchRows()
  rows.push(...cards.withoutMessages)
  appendStatusRows(rows, { ...params, awaitingFirstRun: isAwaitingFirstRun(params, launchRows) })
  appendInterruptedRunRow(rows, params)
  return applyTurnFolds(groupWaggleTurnRows(rows), toTurnFoldInput(params))
}
