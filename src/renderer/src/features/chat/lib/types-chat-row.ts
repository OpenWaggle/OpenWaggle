import type { RunMode, WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionBranchId, SupportedModelId } from '@shared/types/brand'
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
  readonly resolution?: AgentTransportInteractionResolvedEvent | undefined
}

// ─── Turn Divider Props ──────────────────────────────────────

export interface TurnDividerProps {
  turnNumber: number
  agentLabel: string
  agentColor: WaggleAgentColor
  agentModel?: SupportedModelId | undefined
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
  turnDividerProps?: TurnDividerProps | undefined
  assistantModel?: SupportedModelId | undefined
  waggle?: WaggleInfo | undefined
  waggleMeta?: WaggleMessageMetadata | undefined
  /** Terminal message of a folded turn: render only its final text part. */
  turnPresentation?: 'folded' | undefined
  /**
   * The settled turn's reply, which can be continued from, forked after, or copied
   * (`markTurnReplies`); `latest` is the transcript's last one.
   */
  replyActions?: 'reply' | 'latest' | undefined
}

/** The quiet row standing in for one settled turn's work (ADR 0034). */
export interface TurnFoldChatRow {
  type: 'turn-fold'
  /** Stable within a session: derived from the turn's first row id. */
  turnKey: string
  id: string
  label: string
  durationMs: number | null
  interrupted: boolean
  agentColor?: WaggleAgentColor | undefined
}

export interface WaggleTurnChatRow {
  type: 'waggle-turn'
  id: string
  turnDividerProps: TurnDividerProps
  agentColor: WaggleAgentColor
  messages: MessageChatRow[]
  /** ADR 0034: the whole agent turn collapsed behind `foldRow`. */
  folded?: boolean | undefined
  /** Rendered inside the section, between the turn pill and the terminal message. */
  foldRow?: TurnFoldChatRow | undefined
  /**
   * The error the turn's last response failed with. Absent when a later response answered the
   * turn, and on the Run's last failed turn while the Run error row shows the same failure.
   */
  failure?: string | undefined
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
      reason?: 'manual' | 'threshold' | 'overflow' | undefined
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
  | {
      type: 'phase-indicator'
      label: string
      elapsedMs: number
      /** Pi extension status lines (`ctx.ui.setStatus`) for the Run, under the label. */
      details?: readonly { readonly key: string; readonly text: string }[] | undefined
    }
  | { type: 'retry-status'; attempt: number; maxAttempts: number; delayMs: number }
  | {
      type: 'error'
      error: Error
      lastUserMessage: string | null
      dismissedError: string | null
      sessionId: string | null
    }
