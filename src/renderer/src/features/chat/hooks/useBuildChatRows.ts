import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionInterruptedRun } from '@shared/types/session'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { StreamingPhaseState } from '@/features/chat/hooks/useStreamingPhase'
import type { ChatRow, MessageChatRow } from '../lib/types-chat-row'

type ToolResultPart = Extract<UIMessage['parts'][number], { type: 'tool-result' }>
type SummaryRow = Extract<ChatRow, { type: 'branch-summary' | 'compaction-summary' }>

function isToolResultOnlyMessage(message: UIMessage) {
  return message.parts.length > 0 && message.parts.every((part) => part.type === 'tool-result')
}

function sameWaggleTurn(
  current: WaggleMessageMetadata | undefined,
  previous: WaggleMessageMetadata | undefined,
) {
  const bothHaveSessionId = current?.sessionId !== undefined && previous?.sessionId !== undefined
  return (
    current !== undefined &&
    previous !== undefined &&
    current.agentIndex === previous.agentIndex &&
    current.turnNumber === previous.turnNumber &&
    (!bothHaveSessionId || current.sessionId === previous.sessionId)
  )
}

function getWaggleTurnId(meta: WaggleMessageMetadata, firstMessageId: string) {
  return [
    'waggle-turn',
    meta.sessionId ?? 'session',
    String(meta.turnNumber),
    String(meta.agentIndex),
    firstMessageId,
  ].join(':')
}

function withoutInlineTurnDivider(row: MessageChatRow) {
  return {
    ...row,
    showTurnDivider: false,
    turnDividerProps: undefined,
  }
}

function groupWaggleTurnRows(rows: readonly ChatRow[]) {
  const groupedRows: ChatRow[] = []

  for (const row of rows) {
    if (row.type !== 'message' || row.message.role !== 'assistant' || !row.waggleMeta) {
      groupedRows.push(row)
      continue
    }

    const previousRow = groupedRows[groupedRows.length - 1]
    if (
      previousRow?.type === 'waggle-turn' &&
      sameWaggleTurn(row.waggleMeta, previousRow.messages[0]?.waggleMeta)
    ) {
      groupedRows[groupedRows.length - 1] = {
        ...previousRow,
        messages: [...previousRow.messages, withoutInlineTurnDivider(row)],
      }
      continue
    }

    groupedRows.push({
      type: 'waggle-turn',
      id: getWaggleTurnId(row.waggleMeta, row.message.id),
      agentColor: row.waggleMeta.agentColor,
      turnDividerProps: {
        turnNumber: row.waggleMeta.turnNumber,
        agentLabel: row.waggleMeta.agentLabel,
        agentColor: row.waggleMeta.agentColor,
        agentModel: row.waggleMeta.agentModel,
      },
      messages: [withoutInlineTurnDivider(row)],
    })
  }

  return groupedRows
}

function toolCallIds(message: UIMessage) {
  const ids = new Set<string>()
  for (const part of message.parts) {
    if (part.type === 'tool-call') {
      ids.add(part.id)
    }
  }
  return ids
}

function canNestToolResultMessage(target: UIMessage, toolResults: readonly ToolResultPart[]) {
  if (target.role !== 'assistant') {
    return false
  }

  const ids = toolCallIds(target)
  return toolResults.some((part) => ids.has(part.toolCallId))
}

function appendToolResultParts(target: UIMessage, toolResults: readonly ToolResultPart[]) {
  const existingResultIds = new Set(
    target.parts.filter((part) => part.type === 'tool-result').map((part) => part.toolCallId),
  )
  const nextResults = toolResults.filter((part) => !existingResultIds.has(part.toolCallId))
  return nextResults.length > 0 ? { ...target, parts: [...target.parts, ...nextResults] } : target
}

function attachToolResultSource(toolResults: readonly ToolResultPart[], sourceMessageId: string) {
  return toolResults.map((part) => ({ ...part, sourceMessageId }))
}

function getSummaryRow(message: UIMessage): SummaryRow | null {
  const branchSummary = message.metadata?.branchSummary
  if (branchSummary) {
    return {
      type: 'branch-summary',
      id: message.id,
      summary: branchSummary.summary,
    }
  }

  const compactionSummary = message.metadata?.compactionSummary
  if (compactionSummary) {
    return {
      type: 'compaction-summary',
      id: message.id,
      summary: compactionSummary.summary,
      tokensBefore: compactionSummary.tokensBefore,
    }
  }

  return null
}

function tryNestToolResultMessage(rows: ChatRow[], message: UIMessage) {
  if (!isToolResultOnlyMessage(message)) {
    return false
  }

  const previousRow = rows[rows.length - 1]
  const toolResults = message.parts.filter((part) => part.type === 'tool-result')
  const sourcedToolResults = attachToolResultSource(toolResults, message.id)
  if (
    previousRow?.type !== 'message' ||
    !canNestToolResultMessage(previousRow.message, sourcedToolResults)
  ) {
    return false
  }

  rows[rows.length - 1] = {
    ...previousRow,
    message: appendToolResultParts(previousRow.message, sourcedToolResults),
  }
  return true
}

function createMessageRow({
  message,
  meta,
  previousVisibleWaggleMeta,
  isStreaming,
  isLoading,
}: {
  readonly message: UIMessage
  readonly meta: WaggleMessageMetadata | undefined
  readonly previousVisibleWaggleMeta: WaggleMessageMetadata | undefined
  readonly isStreaming: boolean
  readonly isLoading: boolean
}): MessageChatRow {
  const showTurnDivider =
    !!meta && message.role === 'assistant' && !sameWaggleTurn(meta, previousVisibleWaggleMeta)
  return {
    type: 'message',
    message,
    isStreaming,
    isRunActive: isLoading,
    showTurnDivider,
    turnDividerProps: showTurnDivider
      ? {
          turnNumber: meta.turnNumber,
          agentLabel: meta.agentLabel,
          agentColor: meta.agentColor,
          agentModel: meta.agentModel,
        }
      : undefined,
    assistantModel: message.role === 'assistant' ? meta?.agentModel : undefined,
    waggle: meta ? { agentLabel: meta.agentLabel, agentColor: meta.agentColor } : undefined,
    waggleMeta: meta,
  }
}

function appendStatusRows(rows: ChatRow[], params: BuildChatRowsParams) {
  if (params.phase.current) {
    rows.push({
      type: 'phase-indicator',
      label: params.phase.current.label,
      elapsedMs: params.phase.current.elapsedMs,
    })
  }
  if (!params.phase.current && params.isLoading) {
    rows.push({
      type: 'phase-indicator',
      label: 'Thinking',
      elapsedMs: params.phase.totalElapsedMs,
    })
  }
  if (!params.isLoading && !params.phase.current && params.phase.completed.length > 0) {
    rows.push({
      type: 'run-summary',
      phases: params.phase.completed,
      totalMs: params.phase.totalElapsedMs,
    })
  }
  if (params.error && !params.isLoading) {
    rows.push({
      type: 'error',
      error: params.error,
      lastUserMessage: params.lastUserMessage,
      dismissedError: params.dismissedError,
      sessionId: params.sessionId ? String(params.sessionId) : null,
    })
  }
}

interface BuildChatRowsParams {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  lastUserMessage: string | null
  dismissedError: string | null
  sessionId: string | null
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
  phase: StreamingPhaseState
  interruptedRun?: SessionInterruptedRun
}

function appendInterruptedRunRow(rows: ChatRow[], params: BuildChatRowsParams) {
  if (!params.interruptedRun || params.isLoading) {
    return
  }
  rows.push({
    type: 'interrupted-run',
    runId: params.interruptedRun.runId,
    branchId: params.interruptedRun.branchId,
    runMode: params.interruptedRun.runMode,
    model: params.interruptedRun.model,
    interruptedAt: params.interruptedRun.interruptedAt,
  })
}

export function buildChatRows(params: BuildChatRowsParams): ChatRow[] {
  const rows: ChatRow[] = []
  appendInterruptedRunRow(rows, params)

  const lastMessage = params.messages[params.messages.length - 1]
  const lastIsStreaming = params.isLoading && lastMessage?.role === 'assistant'
  let previousVisibleWaggleMeta: WaggleMessageMetadata | undefined

  for (let index = 0; index < params.messages.length; index += 1) {
    const message = params.messages[index]
    const summaryRow = getSummaryRow(message)
    if (summaryRow) {
      rows.push(summaryRow)
      continue
    }
    if (tryNestToolResultMessage(rows, message)) {
      continue
    }

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

    if (meta && message.role === 'assistant') {
      previousVisibleWaggleMeta = meta
    }
  }

  appendStatusRows(rows, params)
  return groupWaggleTurnRows(rows)
}
