import type { SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleAgentColor } from '@shared/types/waggle'
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

// ─── ChatRow Discriminated Union ──────────────────────────

export type ChatRow =
  | {
      type: 'message'
      message: UIMessage
      isStreaming: boolean
      isRunActive: boolean
      showTurnDivider: boolean
      turnDividerProps?: TurnDividerProps
      assistantModel?: SupportedModelId
      waggle?: WaggleInfo
    }
  | { type: 'compaction-summary'; id: string; summary: string; tokensBefore: number }
  | { type: 'phase-indicator'; label: string; elapsedMs: number }
  | { type: 'run-summary'; phases: readonly CompletedPhase[]; totalMs: number }
  | {
      type: 'error'
      error: Error
      lastUserMessage: string | null
      dismissedError: string | null
      conversationId: string | null
    }
