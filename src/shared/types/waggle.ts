import type { TeamConfigId } from './brand'
import type { SupportedModelId } from './llm'

export const WAGGLE_COLLABORATION_MODES = ['sequential'] as const
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number]

export const WAGGLE_AGENT_COLORS = ['blue', 'amber', 'emerald', 'violet'] as const
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number]

export interface WaggleAgentSlot {
  readonly label: string
  readonly model: SupportedModelId
  readonly roleDescription: string
  readonly color: WaggleAgentColor
}

export const WAGGLE_STOP_CONDITIONS = ['consensus', 'user-stop'] as const
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number]

export interface WaggleStopConfig {
  readonly primary: WaggleStopCondition
  readonly maxTurnsSafety: number
}

export interface WaggleConfig {
  readonly mode: WaggleCollaborationMode
  readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot]
  readonly stop: WaggleStopConfig
}

export interface WaggleTeamPreset {
  readonly id: TeamConfigId
  readonly name: string
  readonly description: string
  readonly config: WaggleConfig
  readonly isBuiltIn: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export const WAGGLE_COLLABORATION_STATUSES = [
  'idle',
  'running',
  'paused',
  'completed',
  'stopped',
] as const
export type WaggleCollaborationStatus = (typeof WAGGLE_COLLABORATION_STATUSES)[number]

export interface WaggleFileModificationRecord {
  readonly path: string
  readonly lastModifiedBy: number
  readonly modifiedAt: number
  readonly modificationCount: number
}

export interface WaggleFileConflictWarning {
  readonly path: string
  readonly previousAgent: string
  readonly currentAgent: string
  readonly turnNumber: number
}

export interface WaggleConsensusSignal {
  readonly type: 'explicit-agreement' | 'no-new-information' | 'action-convergence' | 'turn-limit'
  readonly confidence: number
  readonly reason: string
}

export interface WaggleConsensusCheckResult {
  readonly reached: boolean
  readonly confidence: number
  readonly reason: string
  readonly signals: readonly WaggleConsensusSignal[]
}

export interface WaggleStreamMetadata {
  readonly agentIndex: number
  readonly agentLabel: string
  readonly agentColor: WaggleAgentColor
  readonly agentModel: SupportedModelId
  readonly turnNumber: number
  readonly collaborationMode: WaggleCollaborationMode
  readonly isSynthesis?: boolean
  readonly sessionId?: string
}

export interface WaggleMessageMetadata {
  readonly agentIndex: number
  readonly agentLabel: string
  readonly agentColor: WaggleAgentColor
  readonly agentModel?: SupportedModelId
  readonly turnNumber: number
  readonly isSynthesis?: boolean
  /** Unique ID for this waggle session. Groups turns that belong to the same waggle run. */
  readonly sessionId?: string
}

export type WaggleTurnEvent =
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
      readonly agentColor: WaggleAgentColor
      readonly agentModel: SupportedModelId
    }
  | { readonly type: 'consensus-reached'; readonly result: WaggleConsensusCheckResult }
  | { readonly type: 'file-conflict'; readonly warning: WaggleFileConflictWarning }
  | {
      readonly type: 'collaboration-complete'
      readonly reason: string
      readonly totalTurns: number
    }
  | { readonly type: 'synthesis-start' }
  | { readonly type: 'collaboration-stopped'; readonly reason: string }
