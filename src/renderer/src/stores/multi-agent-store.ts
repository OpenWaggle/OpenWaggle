import type { ConversationId } from '@shared/types/brand'
import type {
  CollaborationStatus,
  ConsensusCheckResult,
  FileConflictWarning,
  MultiAgentConfig,
  MultiAgentMessageMetadata,
  MultiAgentTurnEvent,
} from '@shared/types/multi-agent'
import { create } from 'zustand'

interface MultiAgentState {
  // Active collaboration
  activeCollaborationId: ConversationId | null
  activeConfig: MultiAgentConfig | null
  status: CollaborationStatus
  currentTurn: number
  currentAgentIndex: number
  currentAgentLabel: string

  // Ordered metadata for completed (successful) turns — built from turn-end events.
  // The Nth entry corresponds to the Nth assistant UIMessage during live streaming.
  completedTurnMeta: MultiAgentMessageMetadata[]

  // Live message metadata — maps stream messageId → agent metadata during streaming
  liveMessageMetadata: Record<string, MultiAgentMessageMetadata>

  // Events
  fileConflicts: FileConflictWarning[]
  lastConsensusResult: ConsensusCheckResult | null
  completionReason: string | null

  // Actions
  setConfig: (config: MultiAgentConfig) => void
  clearConfig: () => void
  startCollaboration: (conversationId: ConversationId, config: MultiAgentConfig) => void
  handleTurnEvent: (event: MultiAgentTurnEvent) => void
  trackMessageMetadata: (messageId: string, meta: MultiAgentMessageMetadata) => void
  stopCollaboration: () => void
  reset: () => void
}

export const useMultiAgentStore = create<MultiAgentState>((set) => ({
  activeCollaborationId: null,
  activeConfig: null,
  status: 'idle',
  currentTurn: 0,
  currentAgentIndex: 0,
  currentAgentLabel: '',
  completedTurnMeta: [],
  liveMessageMetadata: {},
  fileConflicts: [],
  lastConsensusResult: null,
  completionReason: null,

  setConfig(config) {
    set({ activeConfig: config })
  },

  clearConfig() {
    set({ activeConfig: null })
  },

  startCollaboration(conversationId, config) {
    set({
      activeCollaborationId: conversationId,
      activeConfig: config,
      status: 'running',
      currentTurn: 0,
      currentAgentIndex: 0,
      currentAgentLabel: config.agents[0].label,
      completedTurnMeta: [],
      liveMessageMetadata: {},
      fileConflicts: [],
      lastConsensusResult: null,
      completionReason: null,
    })
  },

  handleTurnEvent(event) {
    switch (event.type) {
      case 'turn-start':
        set({
          currentTurn: event.turnNumber,
          currentAgentIndex: event.agentIndex,
          currentAgentLabel: event.agentLabel,
        })
        break
      case 'consensus-reached':
        set({ lastConsensusResult: event.result })
        break
      case 'file-conflict':
        set((s) => ({ fileConflicts: [...s.fileConflicts, event.warning] }))
        break
      case 'collaboration-complete':
        set({
          status: 'completed',
          completionReason: event.reason,
        })
        break
      case 'collaboration-stopped':
        set({
          status: 'stopped',
          completionReason: event.reason,
        })
        break
      case 'synthesis-start':
        set({
          currentAgentIndex: -1,
          currentAgentLabel: 'Synthesis',
        })
        break
      case 'turn-end':
        set((s) => ({
          completedTurnMeta: [
            ...s.completedTurnMeta,
            {
              agentIndex: event.agentIndex,
              agentLabel: event.agentLabel,
              agentColor: event.agentColor,
              agentModel: event.agentModel,
              turnNumber: event.turnNumber,
              ...(event.agentIndex === -1 ? { isSynthesis: true } : {}),
            },
          ],
        }))
        break
    }
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
      activeConfig: null,
      status: 'idle',
      currentTurn: 0,
      currentAgentIndex: 0,
      currentAgentLabel: '',
      completedTurnMeta: [],
      liveMessageMetadata: {},
      fileConflicts: [],
      lastConsensusResult: null,
      completionReason: null,
    })
  },
}))
