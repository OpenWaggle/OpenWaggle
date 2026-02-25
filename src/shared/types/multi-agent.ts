import type { TeamConfigId } from './brand'
import type { SupportedModelId } from './llm'

// ─── Collaboration Modes ─────────────────────────────────────

export const COLLABORATION_MODES = ['sequential', 'parallel'] as const
export type CollaborationMode = (typeof COLLABORATION_MODES)[number]

// ─── Agent Slot Configuration ────────────────────────────────

export const AGENT_COLORS = ['blue', 'amber', 'emerald', 'violet'] as const
export type AgentColor = (typeof AGENT_COLORS)[number]

export interface AgentSlot {
  readonly label: string
  readonly model: SupportedModelId
  readonly roleDescription: string
  readonly color: AgentColor
}

// ─── Stop Conditions ─────────────────────────────────────────

export const STOP_CONDITIONS = ['consensus', 'user-stop'] as const
export type StopCondition = (typeof STOP_CONDITIONS)[number]

export interface StopConfig {
  readonly primary: StopCondition
  readonly maxTurnsSafety: number
}

// ─── Multi-Agent Configuration ───────────────────────────────

export interface MultiAgentConfig {
  readonly mode: CollaborationMode
  readonly agents: readonly [AgentSlot, AgentSlot]
  readonly stop: StopConfig
}

// ─── Team Presets ────────────────────────────────────────────

export interface TeamPreset {
  readonly id: TeamConfigId
  readonly name: string
  readonly description: string
  readonly config: MultiAgentConfig
  readonly isBuiltIn: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

// ─── Collaboration Status ────────────────────────────────────

export const COLLABORATION_STATUSES = ['idle', 'running', 'paused', 'completed', 'stopped'] as const
export type CollaborationStatus = (typeof COLLABORATION_STATUSES)[number]

// ─── File Conflict Tracking ──────────────────────────────────

export interface FileModificationRecord {
  readonly path: string
  readonly lastModifiedBy: number
  readonly modifiedAt: number
  readonly modificationCount: number
}

export interface FileConflictWarning {
  readonly path: string
  readonly previousAgent: string
  readonly currentAgent: string
  readonly turnNumber: number
}

// ─── Consensus Detection ─────────────────────────────────────

export interface ConsensusSignal {
  readonly type: 'explicit-agreement' | 'no-new-information' | 'action-convergence' | 'turn-limit'
  readonly confidence: number
  readonly reason: string
}

export interface ConsensusCheckResult {
  readonly reached: boolean
  readonly confidence: number
  readonly reason: string
  readonly signals: readonly ConsensusSignal[]
}

// ─── Stream Metadata ─────────────────────────────────────────

export interface MultiAgentStreamMetadata {
  readonly agentIndex: number
  readonly agentLabel: string
  readonly agentColor: AgentColor
  readonly agentModel: SupportedModelId
  readonly turnNumber: number
  readonly collaborationMode: CollaborationMode
  readonly isSynthesis?: boolean
}

// ─── Multi-Agent Message Metadata ────────────────────────────

export interface MultiAgentMessageMetadata {
  readonly agentIndex: number
  readonly agentLabel: string
  readonly agentColor: AgentColor
  readonly agentModel?: SupportedModelId
  readonly turnNumber: number
  readonly isSynthesis?: boolean
}

// ─── Turn Events (main → renderer) ──────────────────────────

export type MultiAgentTurnEvent =
  | {
      readonly type: 'turn-start'
      readonly turnNumber: number
      readonly agentIndex: number
      readonly agentLabel: string
    }
  | {
      readonly type: 'turn-end'
      readonly turnNumber: number
      readonly agentIndex: number
      readonly agentLabel: string
      readonly agentColor: AgentColor
      readonly agentModel: SupportedModelId
    }
  | { readonly type: 'consensus-reached'; readonly result: ConsensusCheckResult }
  | { readonly type: 'file-conflict'; readonly warning: FileConflictWarning }
  | {
      readonly type: 'collaboration-complete'
      readonly reason: string
      readonly totalTurns: number
    }
  | { readonly type: 'synthesis-start' }
  | { readonly type: 'collaboration-stopped'; readonly reason: string }
