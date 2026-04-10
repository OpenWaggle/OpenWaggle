import { safeDecodeUnknown } from '@shared/schema'
import { waggleMetadataSchema } from '@shared/schemas/waggle'
import { SupportedModelId } from '@shared/types/brand'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import type { StreamingPhaseState } from '@/hooks/useStreamingPhase'
import type { ChatRow, TurnSegment } from './types-chat-row'

// ─── Waggle streaming helpers ──────────────────────────────

/**
 * Parse agent metadata from a _turnBoundary tool call's arguments or output.
 * During live streaming, metadata is in `arguments` (available immediately from
 * TOOL_CALL_ARGS). After persistence, it may be in `output` (from TOOL_CALL_END).
 * The value can be a JSON string or an already-parsed object.
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

const TURN_BOUNDARY_PREFIX = '_turnBoundary'

/** Check if a tool-call part is a waggle turn boundary. */
function isTurnBoundary(name: string): boolean {
  return name === TURN_BOUNDARY_PREFIX || name.startsWith(`${TURN_BOUNDARY_PREFIX}:`)
}

/** Extract metadata encoded in the tool name after the colon prefix. */
function extractMetaFromToolName(name: string): WaggleMessageMetadata | undefined {
  const colonIndex = name.indexOf(':')
  if (colonIndex === -1) return undefined
  return parseBoundaryMeta(name.slice(colonIndex + 1))
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
    if (part.type === 'tool-call' && isTurnBoundary(part.name)) {
      // Flush current segment
      segments.push({
        id: `${msg.id}-turn-${String(turnIndex)}`,
        parts: currentParts,
        meta: currentMeta,
      })

      // Extract metadata for the next turn. Try sources in order of availability:
      // 1. Tool name suffix (available from TOOL_CALL_START — first render)
      // 2. Arguments (available from TOOL_CALL_ARGS — second render)
      // 3. Output (available from TOOL_CALL_END — final render)
      currentMeta =
        extractMetaFromToolName(part.name) ??
        parseBoundaryMeta(part.arguments) ??
        parseBoundaryMeta(part.output) ??
        currentMeta
      turnIndex++
      currentParts = []
      continue
    }

    // Skip tool-result parts for _turnBoundary (shouldn't exist, but guard)
    if (
      part.type === 'tool-result' &&
      msg.parts.some(
        (p) => p.type === 'tool-call' && isTurnBoundary(p.name) && p.id === part.toolCallId,
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

const USER_TURN_SCOPE_PREFIX = 'user'
const WAGGLE_TURN_SCOPE_PREFIX = 'waggle'

function turnScopedToolCallKey(turnScope: string, name: string, args: string): string {
  return `${turnScope}:${toolCallKey(name, args)}`
}

function buildUserTurnScope(userTurnIndex: number): string {
  return `${USER_TURN_SCOPE_PREFIX}:${String(userTurnIndex)}`
}

function resolveToolCallTurnScope(
  msg: UIMessage,
  userTurnIndex: number,
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>,
): string {
  if (msg.role === 'assistant') {
    const waggleMeta = waggleMetadataLookup[msg.id]
    if (waggleMeta) {
      return `${WAGGLE_TURN_SCOPE_PREFIX}:${String(waggleMeta.turnNumber)}`
    }
  }
  return buildUserTurnScope(userTurnIndex)
}

function hasVisibleParts(parts: UIMessage['parts']): boolean {
  return parts.some((part) => {
    if (part.type === 'thinking') return false
    if (part.type === 'tool-call' && isTurnBoundary(part.name)) return false
    if (part.type === 'text') return part.content.trim().length > 0
    return true
  })
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

function buildPreferredToolCallMessages(
  messages: UIMessage[],
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>,
): ReadonlyMap<string, string> {
  let userTurnIndex = 0
  const preferred = new Map<string, PreferredToolCallOccurrence>()

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const msg = messages[messageIndex]
    if (msg.role === 'user' && messageIndex > 0) {
      userTurnIndex++
    }

    if (msg.role !== 'assistant') continue
    const turnScope = resolveToolCallTurnScope(msg, userTurnIndex, waggleMetadataLookup)

    for (const part of msg.parts) {
      if (part.type !== 'tool-call' || isTurnBoundary(part.name)) continue

      const key = turnScopedToolCallKey(turnScope, part.name, part.arguments)
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
  turnScope: string,
  preferredMessageIds: ReadonlyMap<string, string>,
): UIMessage | null {
  const duplicateIds = new Set<string>()

  for (const p of msg.parts) {
    if (p.type === 'tool-call' && !isTurnBoundary(p.name)) {
      const key = turnScopedToolCallKey(turnScope, p.name, p.arguments)
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

  if (!hasVisibleParts(filtered)) return null
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
  waggleMetadataLookup,
  phase,
}: BuildChatRowsParams): ChatRow[] {
  const rows: ChatRow[] = []
  const preferredToolCallMessages = buildPreferredToolCallMessages(messages, waggleMetadataLookup)
  let userTurnIndex = 0
  const assistantMessageCount = messages.filter((m) => m.role === 'assistant').length

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  for (let i = 0; i < messages.length; i++) {
    let msg = messages[i]
    const meta = waggleMetadataLookup[msg.id]

    // Deduplication is scoped per user turn. Identical tool calls in later
    // user turns are legitimate and should remain visible.
    if (msg.role === 'user' && i > 0) {
      userTurnIndex++
    }

    // Deduplicate tool-call parts that were re-proposed by the model
    // across continuation runs (TanStack AI TextEngine limitation). Prefer
    // the richest/latest occurrence so terminal denied/completed rows replace
    // stale earlier approval-needed placeholders.
    if (msg.role === 'assistant') {
      const turnScope = resolveToolCallTurnScope(msg, userTurnIndex, waggleMetadataLookup)
      const deduped = deduplicateToolCalls(msg, turnScope, preferredToolCallMessages)
      if (!deduped) continue
      msg = deduped

      // Strip _turnBoundary tool-call parts when there are multiple assistant
      // messages. In that case, each message is a complete turn and boundaries
      // are artifacts — the regular showTurnDivider path handles labels.
      if (assistantMessageCount > 1) {
        const boundaryIds = new Set<string>()
        for (const p of msg.parts) {
          if (p.type === 'tool-call' && isTurnBoundary(p.name)) {
            boundaryIds.add(p.id)
          }
        }
        if (boundaryIds.size > 0) {
          const cleaned = msg.parts.filter((p) => {
            if (p.type === 'tool-call' && boundaryIds.has(p.id)) return false
            if (p.type === 'tool-result' && boundaryIds.has(p.toolCallId)) return false
            return true
          })
          if (!hasVisibleParts(cleaned)) continue
          msg = { ...msg, parts: cleaned }
        }
      }
    }

    // Check for turn boundaries (Waggle streaming).
    // Only use segment splitting when ALL waggle turns are in a single UIMessage
    // (true during live streaming when TanStack AI accumulates everything into one
    // message). When there are multiple assistant messages, each message represents
    // a complete turn — boundaries within them are artifacts, not real turn transitions.
    const hasTurnBoundaries =
      msg.role === 'assistant' &&
      assistantMessageCount <= 1 &&
      msg.parts.some((p) => p.type === 'tool-call' && isTurnBoundary(p.name))

    if (hasTurnBoundaries) {
      const segments = splitAtTurnBoundaries(msg, meta)
      const visibleSegments = segments.filter((segment) => hasVisibleParts(segment.parts))
      if (visibleSegments.length === 0) {
        continue
      }
      for (let segIdx = 0; segIdx < visibleSegments.length; segIdx++) {
        const seg = visibleSegments[segIdx]
        const segMeta = seg.meta
        const prevSegMeta = segIdx > 0 ? visibleSegments[segIdx - 1].meta : undefined
        const showDivider =
          !!segMeta && (segIdx === 0 || prevSegMeta?.agentIndex !== segMeta.agentIndex)

        rows.push({
          type: 'segment',
          segment: seg,
          parentMessage: msg,
          isStreaming:
            lastIsStreaming && i === messages.length - 1 && segIdx === visibleSegments.length - 1,
          isRunActive: isLoading,
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
  // During gaps between continuation runs (clearAgentPhase fired but next
  // run hasn't started yet), show "Thinking" with the total elapsed time
  // so the spinner stays visible throughout the entire interaction.
  //
  // Exception: when proposePlan or askUser is waiting for user input, the
  // stream is still active (isLoading=true) but the spinner should be hidden
  // because the agent is blocked on the user, not "thinking".
  // Only check the last assistant message — the only one that can have a
  // pending tool call during the current stream.
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant')
  const waitingForUserInput =
    lastAssistantMsg?.parts.some(
      (p) =>
        p.type === 'tool-call' &&
        (p.name === 'proposePlan' || p.name === 'askUser') &&
        !lastAssistantMsg.parts.some((r) => r.type === 'tool-result' && r.toolCallId === p.id),
    ) ?? false

  if (phase.current && !waitingForUserInput) {
    rows.push({
      type: 'phase-indicator',
      label: phase.current.label,
      elapsedMs: phase.current.elapsedMs,
    })
  }
  if (!phase.current && isLoading && !waitingForUserInput) {
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
