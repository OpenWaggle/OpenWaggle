import { safeDecodeUnknown } from '@shared/schema'
import { waggleMetadataSchema } from '@shared/schemas/waggle'
import { SupportedModelId } from '@shared/types/brand'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import type { StreamingPhaseState } from '@/hooks/useStreamingPhase'
import type { ChatRow, TurnSegment } from './types-chat-row'

// ─── Waggle streaming helpers ──────────────────────────────

/**
 * Parse agent metadata from a _turnBoundary tool call's output.
 * The StreamProcessor parses the JSON result string into an object,
 * so `output` is typically already an object. Handle both cases.
 */
function parseBoundaryMeta(output: unknown): WaggleMessageMetadata | undefined {
  let obj: unknown = output
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return undefined
    }
  }
  const result = safeDecodeUnknown(waggleMetadataSchema, obj)
  if (!result.success) return undefined
  const data = result.data
  return {
    agentIndex: data.agentIndex,
    agentLabel: data.agentLabel,
    agentColor: data.agentColor,
    agentModel: data.agentModel ? SupportedModelId(data.agentModel) : undefined,
    turnNumber: data.turnNumber,
    ...(data.isSynthesis === true ? { isSynthesis: true } : {}),
  }
}

/**
 * Split a single streaming UIMessage at _turnBoundary tool-call parts.
 * Returns one segment per turn, each with its own parts and agent metadata.
 */
function splitAtTurnBoundaries(
  msg: UIMessage,
  firstTurnMeta: WaggleMessageMetadata | undefined,
): TurnSegment[] {
  const segments: TurnSegment[] = []
  let currentParts: UIMessage['parts'] = []
  let currentMeta = firstTurnMeta
  let turnIndex = 0

  for (const part of msg.parts) {
    if (part.type === 'tool-call' && part.name === '_turnBoundary') {
      // Flush current segment
      segments.push({
        id: `${msg.id}-turn-${String(turnIndex)}`,
        parts: currentParts,
        meta: currentMeta,
      })

      // Extract metadata for the next turn from the boundary's output
      currentMeta = parseBoundaryMeta(part.output) ?? currentMeta
      turnIndex++
      currentParts = []
      continue
    }

    // Skip tool-result parts for _turnBoundary (shouldn't exist, but guard)
    if (
      part.type === 'tool-result' &&
      msg.parts.some(
        (p) => p.type === 'tool-call' && p.name === '_turnBoundary' && p.id === part.toolCallId,
      )
    ) {
      continue
    }

    currentParts.push(part)
  }

  // Flush the final segment (may be empty if still streaming)
  if (currentParts.length > 0 || turnIndex > 0) {
    segments.push({
      id: `${msg.id}-turn-${String(turnIndex)}`,
      parts: currentParts,
      meta: currentMeta,
    })
  }

  return segments
}

// ─── Tool-call dedup helpers ─────────────────────────────────

/**
 * Build a normalised key for a tool-call part so we can detect
 * duplicates across continuation runs.
 * TanStack AI's TextEngine may cause the model to re-propose
 * an identical tool call after a continuation re-execution.
 */
function toolCallKey(name: string, args: string): string {
  return `${name}:${args}`
}

const TOOL_CALL_PENDING_RANK = 1
const TOOL_CALL_ADVANCED_STATE_RANK = 2
const TOOL_CALL_TERMINAL_RESULT_RANK = 3

interface PreferredToolCallOccurrence {
  messageId: string
  messageIndex: number
  rank: number
}

function turnScopedToolCallKey(turnIndex: number, name: string, args: string): string {
  return `${String(turnIndex)}:${toolCallKey(name, args)}`
}

function toolCallRank(msg: UIMessage, toolCallId: string, state: string): number {
  const hasTerminalResult = msg.parts.some(
    (part) => part.type === 'tool-result' && part.toolCallId === toolCallId,
  )
  if (hasTerminalResult) return TOOL_CALL_TERMINAL_RESULT_RANK
  if (
    state === 'input-complete' ||
    state === 'approval-responded' ||
    state === 'output-available'
  ) {
    return TOOL_CALL_ADVANCED_STATE_RANK
  }
  return TOOL_CALL_PENDING_RANK
}

function shouldPreferToolCallOccurrence(
  current: PreferredToolCallOccurrence | undefined,
  next: PreferredToolCallOccurrence,
): boolean {
  if (!current) return true
  if (next.rank !== current.rank) return next.rank > current.rank
  return next.messageIndex > current.messageIndex
}

function buildPreferredToolCallMessages(messages: UIMessage[]): ReadonlyMap<string, string> {
  let turnIndex = 0
  const preferred = new Map<string, PreferredToolCallOccurrence>()

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const msg = messages[messageIndex]
    if (msg.role === 'user' && messageIndex > 0) {
      turnIndex++
    }

    if (msg.role !== 'assistant') continue

    for (const part of msg.parts) {
      if (part.type !== 'tool-call' || part.name === '_turnBoundary') continue

      const key = turnScopedToolCallKey(turnIndex, part.name, part.arguments)
      const candidate: PreferredToolCallOccurrence = {
        messageId: msg.id,
        messageIndex,
        rank: toolCallRank(msg, part.id, part.state),
      }

      if (shouldPreferToolCallOccurrence(preferred.get(key), candidate)) {
        preferred.set(key, candidate)
      }
    }
  }

  return new Map(Array.from(preferred.entries(), ([key, value]) => [key, value.messageId] as const))
}

/**
 * Given a message and a set of already-seen tool-call keys,
 * returns a filtered copy of the message with duplicate tool-call
 * (and their matching tool-result) parts removed.
 * Returns `null` when the message has no visible content left.
 */
function deduplicateToolCalls(
  msg: UIMessage,
  turnIndex: number,
  preferredMessageIds: ReadonlyMap<string, string>,
): UIMessage | null {
  const duplicateIds = new Set<string>()

  for (const p of msg.parts) {
    if (p.type === 'tool-call' && p.name !== '_turnBoundary') {
      const key = turnScopedToolCallKey(turnIndex, p.name, p.arguments)
      if (preferredMessageIds.get(key) !== msg.id) {
        duplicateIds.add(p.id)
      }
    }
  }

  if (duplicateIds.size === 0) return msg

  const filtered = msg.parts.filter((p) => {
    if (p.type === 'tool-call' && duplicateIds.has(p.id)) return false
    if (p.type === 'tool-result' && duplicateIds.has(p.toolCallId)) return false
    return true
  })

  const hasVisible = filtered.some((p) => {
    if (p.type === 'thinking') return false
    if (p.type === 'text') return p.content.trim().length > 0
    return true
  })

  if (!hasVisible) return null
  return { ...msg, parts: filtered }
}

// ─── Row builder ────────────────────────────────────────────────

interface BuildChatRowsParams {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  lastUserMessage: string | null
  dismissedError: string | null
  conversationId: string | null
  model: SupportedModelId
  messageModelLookup: Readonly<Record<string, SupportedModelId>>
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
  model,
  messageModelLookup,
  waggleMetadataLookup,
  phase,
}: BuildChatRowsParams): ChatRow[] {
  const rows: ChatRow[] = []
  const preferredToolCallMessages = buildPreferredToolCallMessages(messages)
  let turnIndex = 0

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  for (let i = 0; i < messages.length; i++) {
    let msg = messages[i]
    const meta = waggleMetadataLookup[msg.id]

    // Deduplication is scoped per user turn. Identical tool calls in later
    // user turns are legitimate and should remain visible.
    if (msg.role === 'user' && i > 0) {
      turnIndex++
    }

    // Deduplicate tool-call parts that were re-proposed by the model
    // across continuation runs (TanStack AI TextEngine limitation). Prefer
    // the richest/latest occurrence so terminal denied/completed rows replace
    // stale earlier approval-needed placeholders.
    if (msg.role === 'assistant') {
      const deduped = deduplicateToolCalls(msg, turnIndex, preferredToolCallMessages)
      if (!deduped) continue
      msg = deduped
    }

    // Check for turn boundaries (Waggle streaming)
    const hasTurnBoundaries =
      msg.role === 'assistant' &&
      msg.parts.some((p) => p.type === 'tool-call' && p.name === '_turnBoundary')

    if (hasTurnBoundaries) {
      const segments = splitAtTurnBoundaries(msg, meta)
      for (let segIdx = 0; segIdx < segments.length; segIdx++) {
        const seg = segments[segIdx]
        const segMeta = seg.meta
        const prevSegMeta = segIdx > 0 ? segments[segIdx - 1].meta : undefined
        const showDivider =
          !!segMeta && segIdx > 0 && prevSegMeta?.agentIndex !== segMeta.agentIndex

        rows.push({
          type: 'segment',
          segment: seg,
          parentMessage: msg,
          isStreaming:
            lastIsStreaming && i === messages.length - 1 && segIdx === segments.length - 1,
          showDivider,
          dividerProps:
            showDivider && segMeta
              ? {
                  turnNumber: segMeta.turnNumber,
                  agentLabel: segMeta.agentLabel,
                  agentColor: segMeta.agentColor,
                  isSynthesis: segMeta.isSynthesis,
                }
              : undefined,
          assistantModel: segMeta?.agentModel ?? model,
          waggle: segMeta
            ? { agentLabel: segMeta.agentLabel, agentColor: segMeta.agentColor }
            : undefined,
        })
      }
      continue
    }

    // Regular message
    const prevMeta = i > 0 ? waggleMetadataLookup[messages[i - 1].id] : undefined
    const showTurnDivider =
      !!meta && msg.role === 'assistant' && (!prevMeta || prevMeta.agentIndex !== meta.agentIndex)

    rows.push({
      type: 'message',
      message: msg,
      isStreaming: lastIsStreaming && i === messages.length - 1,
      showTurnDivider,
      turnDividerProps: showTurnDivider
        ? {
            turnNumber: meta.turnNumber,
            agentLabel: meta.agentLabel,
            agentColor: meta.agentColor,
            isSynthesis: meta.isSynthesis,
          }
        : undefined,
      assistantModel:
        msg.role === 'assistant'
          ? (meta?.agentModel ?? messageModelLookup[msg.id] ?? model)
          : undefined,
      waggle: meta ? { agentLabel: meta.agentLabel, agentColor: meta.agentColor } : undefined,
    })
  }

  // Phase indicator — visible whenever the agent is running.
  // During gaps between continuation runs (clearAgentPhase fired but next
  // run hasn't started yet), show "Thinking" with the total elapsed time
  // so the spinner stays visible throughout the entire interaction.
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
