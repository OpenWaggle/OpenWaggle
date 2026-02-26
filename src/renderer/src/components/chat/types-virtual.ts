import type { SupportedModelId } from '@shared/types/brand'
import type { AgentColor, MultiAgentMessageMetadata } from '@shared/types/multi-agent'
import type { UIMessage } from '@tanstack/ai-react'
import type { CompletedPhase } from '@/hooks/useStreamingPhase'

// ─── Turn Divider Props ──────────────────────────────────────

export interface TurnDividerProps {
  turnNumber: number
  agentLabel: string
  agentColor: AgentColor
  isSynthesis?: boolean
}

// ─── Multi-Agent Info ────────────────────────────────────────

export interface MultiAgentInfo {
  agentLabel: string
  agentColor: AgentColor
}

// ─── Turn Segment (per-turn slice of a multi-agent message) ──

export interface TurnSegment {
  id: string
  parts: UIMessage['parts']
  meta: MultiAgentMessageMetadata | undefined
}

// ─── VirtualRow Discriminated Union ──────────────────────────

export type VirtualRow =
  | {
      type: 'message'
      message: UIMessage
      isStreaming: boolean
      showTurnDivider: boolean
      turnDividerProps?: TurnDividerProps
      assistantModel?: SupportedModelId
      multiAgent?: MultiAgentInfo
    }
  | {
      type: 'segment'
      segment: TurnSegment
      parentMessage: UIMessage
      isStreaming: boolean
      showDivider: boolean
      dividerProps?: TurnDividerProps
      assistantModel?: SupportedModelId
      multiAgent?: MultiAgentInfo
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
