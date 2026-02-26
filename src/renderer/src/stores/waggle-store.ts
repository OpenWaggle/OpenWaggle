import type { ConversationId } from '@shared/types/brand'
import type {
  WaggleCollaborationStatus,
  WaggleConfig,
  WaggleConsensusCheckResult,
  WaggleFileConflictWarning,
  WaggleMessageMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import { create } from 'zustand'

interface WaggleState {
  // Active collaboration
  activeCollaborationId: ConversationId | null
  activeConfig: WaggleConfig | null
  status: WaggleCollaborationStatus
  currentTurn: number
  currentAgentIndex: number
  currentAgentLabel: string

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
  setConfig: (config: WaggleConfig) => void
  clearConfig: () => void
  startCollaboration: (conversationId: ConversationId, config: WaggleConfig) => void
  handleTurnEvent: (event: WaggleTurnEvent) => void
  trackMessageMetadata: (messageId: string, meta: WaggleMessageMetadata) => void
  stopCollaboration: () => void
  reset: () => void
}

export const useWaggleStore = create<WaggleState>((set) => ({
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
    chooseBy(event, 'type')
      .case('turn-start', (value) => {
        set({
          currentTurn: value.turnNumber,
          currentAgentIndex: value.agentIndex,
          currentAgentLabel: value.agentLabel,
        })
      })
      .case('consensus-reached', (value) => {
        set({ lastConsensusResult: value.result })
      })
      .case('file-conflict', (value) => {
        set((s) => ({ fileConflicts: [...s.fileConflicts, value.warning] }))
      })
      .case('collaboration-complete', (value) => {
        set({
          status: 'completed',
          completionReason: value.reason,
        })
      })
      .case('collaboration-stopped', (value) => {
        set({
          status: 'stopped',
          completionReason: value.reason,
        })
      })
      .case('synthesis-start', () => {
        set({
          currentAgentIndex: -1,
          currentAgentLabel: 'Synthesis',
        })
      })
      .case('turn-end', (value) => {
        set((s) => ({
          completedTurnMeta: [
            ...s.completedTurnMeta,
            {
              agentIndex: value.agentIndex,
              agentLabel: value.agentLabel,
              agentColor: value.agentColor,
              agentModel: value.agentModel,
              turnNumber: value.turnNumber,
              ...(value.agentIndex === -1 ? { isSynthesis: true } : {}),
            },
          ],
        }))
      })
      .assertComplete()
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
