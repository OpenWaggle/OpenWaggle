import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWaggleStore } from '../waggle-store'
import {
  ARCHITECT_MODEL,
  makeConfig,
  makeConsensusResult,
  makeFileConflict,
} from './waggle-store.test-utils'

describe('waggle-store collaboration lifecycle behavior', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
  })

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

  it('sets and clears the active config', () => {
    const config = makeConfig()
    useWaggleStore.getState().setConfig(config, null)
    expect(useWaggleStore.getState().activeConfig).toBe(config)

    useWaggleStore.getState().clearConfig()
    expect(useWaggleStore.getState().activeConfig).toBeNull()
  })

  it('initializes collaboration state and first-turn metadata from config', () => {
    const sessionId = SessionId('session-waggle-1')
    const config = makeConfig()

    useWaggleStore.getState().startCollaboration(sessionId, config)

    const state = useWaggleStore.getState()
    expect(state.activeCollaborationId).toBe(sessionId)
    expect(state.activeConfig).toBe(config)
    expect(state.status).toBe('running')
    expect(state.currentTurn).toBe(0)
    expect(state.currentAgentIndex).toBe(0)
    expect(state.currentAgentLabel).toBe('Architect')
    expect(state.initialTurnMeta).toEqual({
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: ARCHITECT_MODEL,
      turnNumber: 0,
    })
  })

  it('resets transient collaboration state on start', () => {
    useWaggleStore.setState({
      completedTurnMeta: [
        {
          agentIndex: 0,
          agentLabel: 'X',
          agentColor: 'blue',
          agentModel: ARCHITECT_MODEL,
          turnNumber: 1,
        },
      ],
      liveMessageMetadata: {
        'msg-1': { agentIndex: 0, agentLabel: 'X', agentColor: 'blue', turnNumber: 1 },
      },
      fileConflicts: [makeFileConflict('src/index.ts')],
      lastConsensusResult: makeConsensusResult(true),
      completionReason: 'old-reason',
    })

    useWaggleStore.getState().startCollaboration(SessionId('session-2'), makeConfig())

    const state = useWaggleStore.getState()
    expect(state.completedTurnMeta).toEqual([])
    expect(state.liveMessageMetadata).toEqual({})
    expect(state.fileConflicts).toEqual([])
    expect(state.lastConsensusResult).toBeNull()
    expect(state.completionReason).toBeNull()
  })

  it('sets status to stopped while preserving collaboration details', () => {
    const config = makeConfig()
    useWaggleStore.getState().startCollaboration(SessionId('session-stop'), config)
    useWaggleStore.getState().handleTurnEvent({
      type: 'turn-end',
      turnNumber: 1,
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: ARCHITECT_MODEL,
    })

    useWaggleStore.getState().stopCollaboration()

    const state = useWaggleStore.getState()
    expect(state.status).toBe('stopped')
    expect(state.activeConfig).toBe(config)
    expect(state.completedTurnMeta).toHaveLength(1)
  })
})
