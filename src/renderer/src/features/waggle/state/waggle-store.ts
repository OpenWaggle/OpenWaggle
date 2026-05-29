import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import {
  isInheritedWaggleModelBinding,
  type WaggleCollaborationStatus,
  type WaggleConfig,
  type WaggleConsensusCheckResult,
  type WaggleFileConflictWarning,
  type WaggleMessageMetadata,
  type WaggleTurnEvent,
} from '@shared/types/waggle'
import { create } from 'zustand'

interface WaggleState {
  // Active collaboration
  activeCollaborationId: SessionId | null
  /** Tracks which session the idle config targets (before startCollaboration). */
  configSessionId: SessionId | null
  activeConfig: WaggleConfig | null
  status: WaggleCollaborationStatus
  currentTurn: number
  currentAgentIndex: number
  currentAgentLabel: string

  // Stable metadata for the very first turn — set once at startCollaboration and
  // never updated. Used by the metadata lookup to avoid depending on currentAgentIndex
  // during the window between turn-start(0) and turn-end(0).
  initialTurnMeta: WaggleMessageMetadata | null

  // Ordered metadata for completed (successful) turns — built from turn-end events.
  // The Nth entry corresponds to the Nth assistant UIMessage during live streaming.
  completedTurnMeta: WaggleMessageMetadata[]

  // Live message metadata — maps stream messageId → agent metadata during streaming
  liveMessageMetadata: Record<string, WaggleMessageMetadata>

  // Events
  fileConflicts: WaggleFileConflictWarning[]
  lastConsensusResult: WaggleConsensusCheckResult | null
  completionReason: string | null

  // Actions
  setConfig: (config: WaggleConfig, sessionId: SessionId | null) => void
  clearConfig: () => void
  startCollaboration: (sessionId: SessionId, config: WaggleConfig) => void
  handleTurnEvent: (event: WaggleTurnEvent) => void
  trackMessageMetadata: (messageId: string, meta: WaggleMessageMetadata) => void
  stopCollaboration: () => void
  reset: () => void
}

export const useWaggleStore = create<WaggleState>((set) => ({
  activeCollaborationId: null,
  configSessionId: null,
  activeConfig: null,
  status: 'idle',
  currentTurn: 0,
  currentAgentIndex: 0,
  currentAgentLabel: '',
  initialTurnMeta: null,
  completedTurnMeta: [],
  liveMessageMetadata: {},
  fileConflicts: [],
  lastConsensusResult: null,
  completionReason: null,

  setConfig(config, sessionId) {
    set({ activeConfig: config, configSessionId: sessionId })
  },

  clearConfig() {
    set({ activeConfig: null, configSessionId: null })
  },

  startCollaboration(sessionId, config) {
    const firstAgent = config.agents[0]
    set({
      activeCollaborationId: sessionId,
      configSessionId: sessionId,
      activeConfig: config,
      status: 'running',
      currentTurn: 0,
      currentAgentIndex: 0,
      currentAgentLabel: firstAgent.label,
      initialTurnMeta: {
        agentIndex: 0,
        agentLabel: firstAgent.label,
        agentColor: firstAgent.color,
        ...(!isInheritedWaggleModelBinding(firstAgent.model)
          ? { agentModel: firstAgent.model }
          : {}),
        turnNumber: 0,
      },
      completedTurnMeta: [],
      liveMessageMetadata: {},
      fileConflicts: [],
      lastConsensusResult: null,
      completionReason: null,
    })
  },

  handleTurnEvent(event) {
    matchBy(event, 'type')
      .with('turn-start', (value) => {
        set({
          currentTurn: value.turnNumber,
          currentAgentIndex: value.agentIndex,
          currentAgentLabel: value.agentLabel,
        })
      })
      .with('consensus-reached', (value) => {
        set({ lastConsensusResult: value.result })
      })
      .with('file-conflict', (value) => {
        set((s) => ({ fileConflicts: [...s.fileConflicts, value.warning] }))
      })
      .with('collaboration-complete', (value) => {
        set({
          status: 'completed',
          completionReason: value.reason,
        })
      })
      .with('collaboration-stopped', (value) => {
        set({
          status: 'stopped',
          completionReason: value.reason,
        })
      })
      .with('turn-end', (value) => {
        set((s) => ({
          completedTurnMeta: [
            ...s.completedTurnMeta,
            {
              agentIndex: value.agentIndex,
              agentLabel: value.agentLabel,
              agentColor: value.agentColor,
              agentModel: value.agentModel,
              turnNumber: value.turnNumber,
            },
          ],
        }))
      })
      .exhaustive()
  },

  trackMessageMetadata(messageId, meta) {
    set((s) => ({
      liveMessageMetadata: { ...s.liveMessageMetadata, [messageId]: meta },
    }))
  },

  stopCollaboration() {
    set({ status: 'stopped' })
  },

  reset() {
    set({
      activeCollaborationId: null,
      configSessionId: null,
      activeConfig: null,
      status: 'idle',
      currentTurn: 0,
      currentAgentIndex: 0,
      currentAgentLabel: '',
      initialTurnMeta: null,
      completedTurnMeta: [],
      liveMessageMetadata: {},
      fileConflicts: [],
      lastConsensusResult: null,
      completionReason: null,
    })
  },
}))
