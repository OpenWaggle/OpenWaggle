import type { SupportedModelId } from '@shared/types/brand'
import type { WaggleAgentColor, WaggleMessageMetadata } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import type { CompletedPhase } from '@/hooks/useStreamingPhase'

// ─── Turn Divider Props ──────────────────────────────────────

export interface TurnDividerProps {
  turnNumber: number
  agentLabel: string
  agentColor: WaggleAgentColor
  isSynthesis?: boolean
}

// ─── Waggle Info ──────────────────────────────────────────────

export interface WaggleInfo {
  agentLabel: string
  agentColor: WaggleAgentColor
}

// ─── Turn Segment (per-turn slice of a Waggle message) ───────

export interface TurnSegment {
  id: string
  parts: UIMessage['parts']
  meta: WaggleMessageMetadata | undefined
}

// ─── ChatRow Discriminated Union ──────────────────────────

export type ChatRow =
  | {
      type: 'message'
      message: UIMessage
      isStreaming: boolean
      showTurnDivider: boolean
      turnDividerProps?: TurnDividerProps
      assistantModel?: SupportedModelId
      waggle?: WaggleInfo
    }
  | {
      type: 'segment'
      segment: TurnSegment
      parentMessage: UIMessage
      isStreaming: boolean
      showDivider: boolean
      dividerProps?: TurnDividerProps
      assistantModel?: SupportedModelId
      waggle?: WaggleInfo
    }
  | { type: 'phase-indicator'; label: string; elapsedMs: number }
  | { type: 'run-summary'; phases: readonly CompletedPhase[]; totalMs: number }
  | {
      type: 'error'
      error: Error
      lastUserMessage: string | null
      dismissedError: string | null
      conversationId: string | null
    }
