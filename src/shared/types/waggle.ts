import {
  type WaggleAgentColor as CoreWaggleAgentColor,
  type WaggleCollaborationMode as CoreWaggleCollaborationMode,
  type WaggleStopCondition as CoreWaggleStopCondition,
  WAGGLE_AGENT_COLORS,
  WAGGLE_INHERIT_MODEL,
} from '@openwaggle/waggle-core'
import { SupportedModelId, type WagglePresetId } from './brand'
import type { SupportedModelId as SupportedModelIdType } from './llm'

export { WAGGLE_AGENT_COLORS, WAGGLE_INHERIT_MODEL }

export type WaggleCollaborationMode = CoreWaggleCollaborationMode
export type WaggleAgentColor = CoreWaggleAgentColor
export type WaggleStopCondition = CoreWaggleStopCondition
export type WaggleModelBinding = typeof WAGGLE_INHERIT_MODEL | SupportedModelIdType

export function createWaggleModelBinding(model: string): WaggleModelBinding {
  return model === WAGGLE_INHERIT_MODEL ? WAGGLE_INHERIT_MODEL : SupportedModelId(model)
}

export function isInheritedWaggleModelBinding(
  model: WaggleModelBinding,
): model is typeof WAGGLE_INHERIT_MODEL {
  return model === WAGGLE_INHERIT_MODEL
}

export interface WaggleAgentSlot {
  readonly label: string
  readonly model: WaggleModelBinding
  readonly roleDescription: string
  readonly color: WaggleAgentColor
}

export interface WaggleStopConfig {
  readonly primary: WaggleStopCondition
  readonly maxTurnsSafety: number
}

export interface WaggleConfig {
  readonly mode: WaggleCollaborationMode
  readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot]
  readonly stop: WaggleStopConfig
}

export interface WagglePreset {
  readonly id: WagglePresetId
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
  readonly sessionId?: string
}

export interface WaggleMessageMetadata {
  readonly agentIndex: number
  readonly agentLabel: string
  readonly agentColor: WaggleAgentColor
  readonly agentModel?: SupportedModelId
  readonly turnNumber: number
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
  | { readonly type: 'collaboration-stopped'; readonly reason: string }
