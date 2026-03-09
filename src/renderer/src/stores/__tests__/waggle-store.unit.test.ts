import { ConversationId } from '@shared/types/brand'
import type {
  WaggleConfig,
  WaggleConsensusCheckResult,
  WaggleFileConflictWarning,
  WaggleMessageMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWaggleStore } from '../waggle-store'

// ─── Test Fixtures ──────────────────────────────────────────

function makeConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: 'claude-sonnet-4-20250514' as never,
        roleDescription: 'System designer',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: 'gpt-4o' as never,
        roleDescription: 'Code reviewer',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 10 },
  }
}

function makeConsensusResult(reached: boolean): WaggleConsensusCheckResult {
  return {
    reached,
    confidence: reached ? 0.85 : 0.3,
    reason: reached ? 'Agents agree on the approach' : 'Still debating',
    signals: [
      { type: 'explicit-agreement', confidence: 0.9, reason: 'Both agents confirmed approach' },
    ],
  }
}

function makeFileConflict(path: string): WaggleFileConflictWarning {
  return {
    path,
    previousAgent: 'Architect',
    currentAgent: 'Reviewer',
    turnNumber: 2,
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('waggle-store', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
  })

  describe('initial state', () => {
    it('starts with idle status and null collaboration', () => {
      const state = useWaggleStore.getState()
      expect(state.activeCollaborationId).toBeNull()
      expect(state.activeConfig).toBeNull()
      expect(state.status).toBe('idle')
      expect(state.currentTurn).toBe(0)
      expect(state.currentAgentIndex).toBe(0)
      expect(state.currentAgentLabel).toBe('')
      expect(state.completedTurnMeta).toEqual([])
      expect(state.liveMessageMetadata).toEqual({})
      expect(state.fileConflicts).toEqual([])
      expect(state.lastConsensusResult).toBeNull()
      expect(state.completionReason).toBeNull()
    })
  })

  describe('setConfig / clearConfig', () => {
    it('setConfig stores the config', () => {
      const config = makeConfig()
      useWaggleStore.getState().setConfig(config)
      expect(useWaggleStore.getState().activeConfig).toBe(config)
    })

    it('clearConfig removes the config', () => {
      useWaggleStore.getState().setConfig(makeConfig())
      useWaggleStore.getState().clearConfig()
      expect(useWaggleStore.getState().activeConfig).toBeNull()
    })
  })

  describe('startCollaboration', () => {
    it('initializes collaboration state from config', () => {
      const conversationId = ConversationId('conv-waggle-1')
      const config = makeConfig()
      useWaggleStore.getState().startCollaboration(conversationId, config)

      const state = useWaggleStore.getState()
      expect(state.activeCollaborationId).toBe(conversationId)
      expect(state.activeConfig).toBe(config)
      expect(state.status).toBe('running')
      expect(state.currentTurn).toBe(0)
      expect(state.currentAgentIndex).toBe(0)
      expect(state.currentAgentLabel).toBe('Architect')
    })

    it('resets all transient state on start', () => {
      // Pollute state first
      useWaggleStore.setState({
        completedTurnMeta: [{ agentIndex: 0, agentLabel: 'X', agentColor: 'blue', turnNumber: 1 }],
        liveMessageMetadata: {
          'msg-1': { agentIndex: 0, agentLabel: 'X', agentColor: 'blue', turnNumber: 1 },
        },
        fileConflicts: [makeFileConflict('src/index.ts')],
        lastConsensusResult: makeConsensusResult(true),
        completionReason: 'old-reason',
      })

      useWaggleStore.getState().startCollaboration(ConversationId('conv-2'), makeConfig())

      const state = useWaggleStore.getState()
      expect(state.completedTurnMeta).toEqual([])
      expect(state.liveMessageMetadata).toEqual({})
      expect(state.fileConflicts).toEqual([])
      expect(state.lastConsensusResult).toBeNull()
      expect(state.completionReason).toBeNull()
    })
  })

  describe('handleTurnEvent', () => {
    beforeEach(() => {
      useWaggleStore.getState().startCollaboration(ConversationId('conv-events'), makeConfig())
    })

    it('handles turn-start by updating current turn info', () => {
      const event: WaggleTurnEvent = {
        type: 'turn-start',
        turnNumber: 1,
        agentIndex: 1,
        agentLabel: 'Reviewer',
      }
      useWaggleStore.getState().handleTurnEvent(event)

      const state = useWaggleStore.getState()
      expect(state.currentTurn).toBe(1)
      expect(state.currentAgentIndex).toBe(1)
      expect(state.currentAgentLabel).toBe('Reviewer')
    })

    it('handles turn-end by appending completed turn metadata', () => {
      const event: WaggleTurnEvent = {
        type: 'turn-end',
        turnNumber: 1,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: 'claude-sonnet-4-20250514' as never,
      }
      useWaggleStore.getState().handleTurnEvent(event)

      const meta = useWaggleStore.getState().completedTurnMeta
      expect(meta).toHaveLength(1)
      expect(meta[0].agentLabel).toBe('Architect')
      expect(meta[0].agentColor).toBe('blue')
      expect(meta[0].turnNumber).toBe(1)
    })

    it('handles turn-end with synthesis agent (agentIndex -1) by setting isSynthesis', () => {
      const event: WaggleTurnEvent = {
        type: 'turn-end',
        turnNumber: 3,
        agentIndex: -1,
        agentLabel: 'Synthesis',
        agentColor: 'emerald',
        agentModel: 'claude-sonnet-4-20250514' as never,
      }
      useWaggleStore.getState().handleTurnEvent(event)

      const meta = useWaggleStore.getState().completedTurnMeta
      expect(meta).toHaveLength(1)
      expect(meta[0].isSynthesis).toBe(true)
    })

    it('handles turn-end without synthesis does not set isSynthesis', () => {
      const event: WaggleTurnEvent = {
        type: 'turn-end',
        turnNumber: 1,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: 'claude-sonnet-4-20250514' as never,
      }
      useWaggleStore.getState().handleTurnEvent(event)

      const meta = useWaggleStore.getState().completedTurnMeta
      expect(meta[0].isSynthesis).toBeUndefined()
    })

    it('handles consensus-reached by storing the result', () => {
      const result = makeConsensusResult(true)
      const event: WaggleTurnEvent = {
        type: 'consensus-reached',
        result,
      }
      useWaggleStore.getState().handleTurnEvent(event)

      expect(useWaggleStore.getState().lastConsensusResult).toBe(result)
    })

    it('handles file-conflict by appending to the conflicts list', () => {
      const warning = makeFileConflict('src/utils.ts')
      const event: WaggleTurnEvent = {
        type: 'file-conflict',
        warning,
      }
      useWaggleStore.getState().handleTurnEvent(event)

      const conflicts = useWaggleStore.getState().fileConflicts
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].path).toBe('src/utils.ts')
    })

    it('accumulates multiple file conflicts', () => {
      useWaggleStore.getState().handleTurnEvent({
        type: 'file-conflict',
        warning: makeFileConflict('a.ts'),
      })
      useWaggleStore.getState().handleTurnEvent({
        type: 'file-conflict',
        warning: makeFileConflict('b.ts'),
      })

      expect(useWaggleStore.getState().fileConflicts).toHaveLength(2)
    })

    it('handles collaboration-complete by setting status and reason', () => {
      const event: WaggleTurnEvent = {
        type: 'collaboration-complete',
        reason: 'Consensus reached after 4 turns',
        totalTurns: 4,
      }
      useWaggleStore.getState().handleTurnEvent(event)

      const state = useWaggleStore.getState()
      expect(state.status).toBe('completed')
      expect(state.completionReason).toBe('Consensus reached after 4 turns')
    })

    it('handles collaboration-stopped by setting stopped status and reason', () => {
      const event: WaggleTurnEvent = {
        type: 'collaboration-stopped',
        reason: 'User cancelled',
      }
      useWaggleStore.getState().handleTurnEvent(event)

      const state = useWaggleStore.getState()
      expect(state.status).toBe('stopped')
      expect(state.completionReason).toBe('User cancelled')
    })

    it('handles synthesis-start by setting synthesis agent label', () => {
      const event: WaggleTurnEvent = { type: 'synthesis-start' }
      useWaggleStore.getState().handleTurnEvent(event)

      const state = useWaggleStore.getState()
      expect(state.currentAgentIndex).toBe(-1)
      expect(state.currentAgentLabel).toBe('Synthesis')
    })

    it('accumulates completed turn metadata across multiple turn-end events', () => {
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-end',
        turnNumber: 1,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: 'claude-sonnet-4-20250514' as never,
      })
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-end',
        turnNumber: 2,
        agentIndex: 1,
        agentLabel: 'Reviewer',
        agentColor: 'amber',
        agentModel: 'gpt-4o' as never,
      })

      const meta = useWaggleStore.getState().completedTurnMeta
      expect(meta).toHaveLength(2)
      expect(meta[0].agentLabel).toBe('Architect')
      expect(meta[1].agentLabel).toBe('Reviewer')
    })
  })

  describe('trackMessageMetadata', () => {
    it('stores metadata keyed by message ID', () => {
      const meta: WaggleMessageMetadata = {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 1,
      }
      useWaggleStore.getState().trackMessageMetadata('msg-123', meta)

      expect(useWaggleStore.getState().liveMessageMetadata['msg-123']).toBe(meta)
    })

    it('preserves existing metadata when tracking new messages', () => {
      const meta1: WaggleMessageMetadata = {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 1,
      }
      const meta2: WaggleMessageMetadata = {
        agentIndex: 1,
        agentLabel: 'Reviewer',
        agentColor: 'amber',
        turnNumber: 2,
      }
      useWaggleStore.getState().trackMessageMetadata('msg-1', meta1)
      useWaggleStore.getState().trackMessageMetadata('msg-2', meta2)

      const metadata = useWaggleStore.getState().liveMessageMetadata
      expect(metadata['msg-1']).toBe(meta1)
      expect(metadata['msg-2']).toBe(meta2)
    })

    it('overwrites metadata for the same message ID', () => {
      const meta1: WaggleMessageMetadata = {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 1,
      }
      const meta2: WaggleMessageMetadata = {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 2,
      }
      useWaggleStore.getState().trackMessageMetadata('msg-1', meta1)
      useWaggleStore.getState().trackMessageMetadata('msg-1', meta2)

      expect(useWaggleStore.getState().liveMessageMetadata['msg-1']).toBe(meta2)
    })
  })

  describe('stopCollaboration', () => {
    it('sets status to stopped', () => {
      useWaggleStore.getState().startCollaboration(ConversationId('conv-stop'), makeConfig())
      useWaggleStore.getState().stopCollaboration()

      expect(useWaggleStore.getState().status).toBe('stopped')
    })

    it('preserves other state (config, turn meta) when stopping', () => {
      const config = makeConfig()
      useWaggleStore.getState().startCollaboration(ConversationId('conv-stop'), config)
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-end',
        turnNumber: 1,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: 'claude-sonnet-4-20250514' as never,
      })

      useWaggleStore.getState().stopCollaboration()

      const state = useWaggleStore.getState()
      expect(state.activeConfig).toBe(config)
      expect(state.completedTurnMeta).toHaveLength(1)
    })
  })

  describe('reset', () => {
    it('returns all state to initial defaults', () => {
      // Fill in some non-default state
      useWaggleStore.getState().startCollaboration(ConversationId('conv-reset'), makeConfig())
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-start',
        turnNumber: 1,
        agentIndex: 1,
        agentLabel: 'Reviewer',
      })
      useWaggleStore.getState().handleTurnEvent({
        type: 'file-conflict',
        warning: makeFileConflict('x.ts'),
      })
      useWaggleStore.getState().trackMessageMetadata('msg-1', {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 1,
      })

      useWaggleStore.getState().reset()

      const state = useWaggleStore.getState()
      expect(state.activeCollaborationId).toBeNull()
      expect(state.activeConfig).toBeNull()
      expect(state.status).toBe('idle')
      expect(state.currentTurn).toBe(0)
      expect(state.currentAgentIndex).toBe(0)
      expect(state.currentAgentLabel).toBe('')
      expect(state.completedTurnMeta).toEqual([])
      expect(state.liveMessageMetadata).toEqual({})
      expect(state.fileConflicts).toEqual([])
      expect(state.lastConsensusResult).toBeNull()
      expect(state.completionReason).toBeNull()
    })
  })

  describe('full lifecycle', () => {
    it('tracks a complete collaboration from start to consensus completion', () => {
      const conversationId = ConversationId('conv-lifecycle')
      const config = makeConfig()

      // Start
      useWaggleStore.getState().startCollaboration(conversationId, config)
      expect(useWaggleStore.getState().status).toBe('running')

      // Turn 1: Architect
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-start',
        turnNumber: 1,
        agentIndex: 0,
        agentLabel: 'Architect',
      })
      useWaggleStore.getState().trackMessageMetadata('msg-t1', {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 1,
      })
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-end',
        turnNumber: 1,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: 'claude-sonnet-4-20250514' as never,
      })

      // Turn 2: Reviewer
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-start',
        turnNumber: 2,
        agentIndex: 1,
        agentLabel: 'Reviewer',
      })
      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-end',
        turnNumber: 2,
        agentIndex: 1,
        agentLabel: 'Reviewer',
        agentColor: 'amber',
        agentModel: 'gpt-4o' as never,
      })

      // Consensus reached
      useWaggleStore.getState().handleTurnEvent({
        type: 'consensus-reached',
        result: makeConsensusResult(true),
      })

      // Synthesis
      useWaggleStore.getState().handleTurnEvent({ type: 'synthesis-start' })
      expect(useWaggleStore.getState().currentAgentLabel).toBe('Synthesis')

      useWaggleStore.getState().handleTurnEvent({
        type: 'turn-end',
        turnNumber: 3,
        agentIndex: -1,
        agentLabel: 'Synthesis',
        agentColor: 'emerald',
        agentModel: 'claude-sonnet-4-20250514' as never,
      })

      // Collaboration complete
      useWaggleStore.getState().handleTurnEvent({
        type: 'collaboration-complete',
        reason: 'Consensus reached',
        totalTurns: 3,
      })

      const finalState = useWaggleStore.getState()
      expect(finalState.status).toBe('completed')
      expect(finalState.completionReason).toBe('Consensus reached')
      expect(finalState.completedTurnMeta).toHaveLength(3)
      expect(finalState.lastConsensusResult?.reached).toBe(true)
    })
  })
})
