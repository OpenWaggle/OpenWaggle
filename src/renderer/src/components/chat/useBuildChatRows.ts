import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionInterruptedRun } from '@shared/types/session'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { StreamingPhaseState } from '@/hooks/useStreamingPhase'
import type { ChatRow, MessageChatRow } from './types-chat-row'

// ─── Row builder ────────────────────────────────────────────────

type ToolResultPart = Extract<UIMessage['parts'][number], { type: 'tool-result' }>

function isToolResultOnlyMessage(message: UIMessage): boolean {
  return message.parts.length > 0 && message.parts.every((part) => part.type === 'tool-result')
}

function sameWaggleTurn(
  current: WaggleMessageMetadata | undefined,
  previous: WaggleMessageMetadata | undefined,
): boolean {
  const bothHaveSessionId = current?.sessionId !== undefined && previous?.sessionId !== undefined
  return (
    current !== undefined &&
    previous !== undefined &&
    current.agentIndex === previous.agentIndex &&
    current.turnNumber === previous.turnNumber &&
    (!bothHaveSessionId || current.sessionId === previous.sessionId)
  )
}

function getWaggleTurnId(meta: WaggleMessageMetadata, firstMessageId: string): string {
  return [
    'waggle-turn',
    meta.sessionId ?? 'session',
    String(meta.turnNumber),
    String(meta.agentIndex),
    firstMessageId,
  ].join(':')
}

function withoutInlineTurnDivider(row: MessageChatRow): MessageChatRow {
  return {
    ...row,
    showTurnDivider: false,
    turnDividerProps: undefined,
  }
}

function groupWaggleTurnRows(rows: readonly ChatRow[]): ChatRow[] {
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

function toolCallIds(message: UIMessage): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const part of message.parts) {
    if (part.type === 'tool-call') {
      ids.add(part.id)
    }
  }
  return ids
}

function canNestToolResultMessage(
  target: UIMessage,
  toolResults: readonly ToolResultPart[],
): boolean {
  if (target.role !== 'assistant') {
    return false
  }

  const ids = toolCallIds(target)
  return toolResults.some((part) => ids.has(part.toolCallId))
}

function appendToolResultParts(
  target: UIMessage,
  toolResults: readonly ToolResultPart[],
): UIMessage {
  const existingResultIds = new Set(
    target.parts
      .filter((part): part is ToolResultPart => part.type === 'tool-result')
      .map((part) => part.toolCallId),
  )
  const nextResults = toolResults.filter((part) => !existingResultIds.has(part.toolCallId))
  return nextResults.length > 0 ? { ...target, parts: [...target.parts, ...nextResults] } : target
}

function attachToolResultSource(
  toolResults: readonly ToolResultPart[],
  sourceMessageId: string,
): readonly ToolResultPart[] {
  return toolResults.map((part) => ({ ...part, sourceMessageId }))
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

export function buildChatRows({
  messages,
  isLoading,
  error,
  lastUserMessage,
  dismissedError,
  sessionId,
  waggleMetadataLookup,
  phase,
  interruptedRun,
}: BuildChatRowsParams): ChatRow[] {
  const rows: ChatRow[] = []

  if (interruptedRun && !isLoading) {
    rows.push({
      type: 'interrupted-run',
      runId: interruptedRun.runId,
      branchId: interruptedRun.branchId,
      runMode: interruptedRun.runMode,
      model: interruptedRun.model,
      interruptedAt: interruptedRun.interruptedAt,
    })
  }

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'
  let previousVisibleWaggleMeta: WaggleMessageMetadata | undefined

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const meta = waggleMetadataLookup[msg.id]
    const branchSummary = msg.metadata?.branchSummary
    const compactionSummary = msg.metadata?.compactionSummary

    if (branchSummary) {
      rows.push({
        type: 'branch-summary',
        id: msg.id,
        summary: branchSummary.summary,
      })
      continue
    }

    if (compactionSummary) {
      rows.push({
        type: 'compaction-summary',
        id: msg.id,
        summary: compactionSummary.summary,
        tokensBefore: compactionSummary.tokensBefore,
      })
      continue
    }

    if (isToolResultOnlyMessage(msg)) {
      const previousRow = rows[rows.length - 1]
      const toolResults = msg.parts.filter(
        (part): part is ToolResultPart => part.type === 'tool-result',
      )
      const sourcedToolResults = attachToolResultSource(toolResults, msg.id)
      if (
        previousRow?.type === 'message' &&
        canNestToolResultMessage(previousRow.message, sourcedToolResults)
      ) {
        rows[rows.length - 1] = {
          ...previousRow,
          message: appendToolResultParts(previousRow.message, sourcedToolResults),
        }
        continue
      }
    }

    // Regular message
    const showTurnDivider =
      !!meta && msg.role === 'assistant' && !sameWaggleTurn(meta, previousVisibleWaggleMeta)

    rows.push({
      type: 'message',
      message: msg,
      isStreaming: lastIsStreaming && i === messages.length - 1,
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
      assistantModel: msg.role === 'assistant' ? meta?.agentModel : undefined,
      waggle: meta ? { agentLabel: meta.agentLabel, agentColor: meta.agentColor } : undefined,
      waggleMeta: meta,
    })

    if (meta && msg.role === 'assistant') {
      previousVisibleWaggleMeta = meta
    }
  }

  // Phase indicator — visible whenever the agent is running.
  if (phase.current) {
    rows.push({
      type: 'phase-indicator',
      label: phase.current.label,
      elapsedMs: phase.current.elapsedMs,
    })
  }
  if (!phase.current && isLoading) {
    rows.push({
      type: 'phase-indicator',
      label: 'Thinking',
      elapsedMs: phase.totalElapsedMs,
    })
  }

  // Run summary — shown after run completes
  if (!isLoading && !phase.current && phase.completed.length > 0) {
    rows.push({
      type: 'run-summary',
      phases: phase.completed,
      totalMs: phase.totalElapsedMs,
    })
  }

  // Error display
  if (error && !isLoading) {
    rows.push({
      type: 'error',
      error,
      lastUserMessage,
      dismissedError,
      sessionId: sessionId ? String(sessionId) : null,
    })
  }

  return groupWaggleTurnRows(rows)
}
