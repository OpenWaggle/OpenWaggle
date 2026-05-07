import type { RunMode } from '@shared/types/background-run'
import type { SessionBranchId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleAgentColor, WaggleMessageMetadata } from '@shared/types/waggle'
import type { CompletedPhase } from '@/hooks/useStreamingPhase'

// ─── Turn Divider Props ──────────────────────────────────────

export interface TurnDividerProps {
  turnNumber: number
  agentLabel: string
  agentColor: WaggleAgentColor
  agentModel?: SupportedModelId
}

// ─── Waggle Info ──────────────────────────────────────────────

export interface WaggleInfo {
  agentLabel: string
  agentColor: WaggleAgentColor
}

export interface MessageChatRow {
  type: 'message'
  message: UIMessage
  isStreaming: boolean
  isRunActive: boolean
  showTurnDivider: boolean
  turnDividerProps?: TurnDividerProps
  assistantModel?: SupportedModelId
  waggle?: WaggleInfo
  waggleMeta?: WaggleMessageMetadata
}

export interface WaggleTurnChatRow {
  type: 'waggle-turn'
  id: string
  turnDividerProps: TurnDividerProps
  agentColor: WaggleAgentColor
  messages: MessageChatRow[]
}

// ─── ChatRow Discriminated Union ──────────────────────────

export type ChatRow =
  | {
      type: 'interrupted-run'
      runId: string
      branchId: SessionBranchId
      runMode: RunMode
      model: SupportedModelId
      interruptedAt: number
    }
  | MessageChatRow
  | WaggleTurnChatRow
  | { type: 'branch-summary'; id: string; summary: string }
  | { type: 'compaction-summary'; id: string; summary: string; tokensBefore: number }
  | { type: 'phase-indicator'; label: string; elapsedMs: number }
  | { type: 'run-summary'; phases: readonly CompletedPhase[]; totalMs: number }
  | {
      type: 'error'
      error: Error
      lastUserMessage: string | null
      dismissedError: string | null
      sessionId: string | null
    }
