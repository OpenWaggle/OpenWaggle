import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type {
  AgentTransportCustomEvent,
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import type { WaggleAgentColor, WaggleMessageMetadata } from '@shared/types/waggle'

export type AgentInteractionEvent =
  | AgentTransportInteractionRequestEvent
  | AgentTransportInteractionResolvedEvent

export interface AgentInteractionTranscriptItem {
  readonly request: AgentTransportInteractionRequestEvent
  readonly resolution?: AgentTransportInteractionResolvedEvent
}

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
  /** Terminal message of a folded turn: render only its final text part. */
  turnPresentation?: 'folded'
}

/** The quiet row standing in for one settled turn's work (ADR 0033). */
export interface TurnFoldChatRow {
  type: 'turn-fold'
  /** Stable within a session: derived from the turn's first row id. */
  turnKey: string
  id: string
  label: string
  durationMs: number | null
  interrupted: boolean
  agentColor?: WaggleAgentColor
}

export interface WaggleTurnChatRow {
  type: 'waggle-turn'
  id: string
  turnDividerProps: TurnDividerProps
  agentColor: WaggleAgentColor
  messages: MessageChatRow[]
  /** ADR 0033: the whole agent turn collapsed behind `foldRow`. */
  folded?: boolean
  /** Rendered inside the section, between the turn pill and the terminal message. */
  foldRow?: TurnFoldChatRow
}

// ─── ChatRow Discriminated Union ──────────────────────────

export type ChatRow =
  | MessageChatRow
  | TurnFoldChatRow
  | { type: 'worktree-launch'; id: string; sessionId: string; launch: WorktreeLaunchSnapshot }
  | WaggleTurnChatRow
  | { type: 'agent-loop-custom-message'; event: AgentTransportCustomEvent }
  | { type: 'agent-loop-interaction'; item: AgentInteractionTranscriptItem }
  | { type: 'branch-summary'; id: string; summary: string }
  | {
      type: 'compaction-summary'
      id: string
      summary: string
      tokensBefore: number
      reason?: 'manual' | 'threshold' | 'overflow'
    }
  | {
      type: 'compaction-status'
      id: string
      anchorMessageCount: number
      announce: boolean
      state:
        | 'manual-running'
        | 'manual-complete'
        | 'automatic-running'
        | 'automatic-complete'
        | 'legacy-complete'
    }
  | { type: 'phase-indicator'; label: string; elapsedMs: number }
  | {
      type: 'error'
      error: Error
      lastUserMessage: string | null
      dismissedError: string | null
      sessionId: string | null
    }
