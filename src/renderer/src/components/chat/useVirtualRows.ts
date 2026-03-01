import { waggleMetadataSchema } from '@shared/schemas/waggle'
import { SupportedModelId } from '@shared/types/brand'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import type { StreamingPhaseState } from '@/hooks/useStreamingPhase'
import type { TurnSegment, VirtualRow } from './types-virtual'

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
  const result = waggleMetadataSchema.safeParse(obj)
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

// ─── Row builder ────────────────────────────────────────────────

interface BuildVirtualRowsParams {
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

export function buildVirtualRows({
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
}: BuildVirtualRowsParams): VirtualRow[] {
  const rows: VirtualRow[] = []

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const meta = waggleMetadataLookup[msg.id]

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

  // Phase indicator — visible whenever the agent is running
  if (phase.current) {
    rows.push({
      type: 'phase-indicator',
      label: phase.current.label,
      elapsedMs: phase.current.elapsedMs,
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
