import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { StreamingPhaseState } from '@/hooks/useStreamingPhase'
import type { ChatRow } from './types-chat-row'

// ─── Row builder ────────────────────────────────────────────────

type ToolResultPart = Extract<UIMessage['parts'][number], { type: 'tool-result' }>

function isToolResultOnlyMessage(message: UIMessage): boolean {
  return message.parts.length > 0 && message.parts.every((part) => part.type === 'tool-result')
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

interface BuildChatRowsParams {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  lastUserMessage: string | null
  dismissedError: string | null
  conversationId: string | null
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
  phase: StreamingPhaseState
}

export function buildChatRows({
  messages,
  isLoading,
  error,
  lastUserMessage,
  dismissedError,
  conversationId,
  waggleMetadataLookup,
  phase,
}: BuildChatRowsParams): ChatRow[] {
  const rows: ChatRow[] = []

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const meta = waggleMetadataLookup[msg.id]
    const compactionSummary = msg.metadata?.compactionSummary

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
      if (
        previousRow?.type === 'message' &&
        canNestToolResultMessage(previousRow.message, toolResults)
      ) {
        rows[rows.length - 1] = {
          ...previousRow,
          message: appendToolResultParts(previousRow.message, toolResults),
        }
        continue
      }
    }

    // Regular message
    const prevMeta = i > 0 ? waggleMetadataLookup[messages[i - 1].id] : undefined
    const showTurnDivider =
      !!meta && msg.role === 'assistant' && (!prevMeta || prevMeta.agentIndex !== meta.agentIndex)

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
            isSynthesis: meta.isSynthesis,
          }
        : undefined,
      assistantModel: msg.role === 'assistant' ? meta?.agentModel : undefined,
      waggle: meta ? { agentLabel: meta.agentLabel, agentColor: meta.agentColor } : undefined,
    })
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
      conversationId: conversationId ? String(conversationId) : null,
    })
  }

  return rows
}
