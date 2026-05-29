import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWaggleStore } from '../waggle-store'
import {
  ARCHITECT_MODEL,
  makeConfig,
  makeConsensusResult,
  makeFileConflict,
  makeMessageMetadata,
  REVIEWER_MODEL,
} from './waggle-store.test-utils'

describe('waggle-store metadata and reset behavior', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
  })

  it('stores metadata keyed by message id', () => {
    const meta = makeMessageMetadata()

    useWaggleStore.getState().trackMessageMetadata('msg-123', meta)

    expect(useWaggleStore.getState().liveMessageMetadata['msg-123']).toBe(meta)
  })

  it('preserves existing metadata when tracking new messages', () => {
    const meta1 = makeMessageMetadata()
    const meta2 = makeMessageMetadata({
      agentIndex: 1,
      agentLabel: 'Reviewer',
      agentColor: 'amber',
      turnNumber: 2,
    })

    useWaggleStore.getState().trackMessageMetadata('msg-1', meta1)
    useWaggleStore.getState().trackMessageMetadata('msg-2', meta2)

    const metadata = useWaggleStore.getState().liveMessageMetadata
    expect(metadata['msg-1']).toBe(meta1)
    expect(metadata['msg-2']).toBe(meta2)
  })

  it('overwrites metadata for the same message id', () => {
    const meta1 = makeMessageMetadata({ turnNumber: 1 })
    const meta2 = makeMessageMetadata({ turnNumber: 2 })

    useWaggleStore.getState().trackMessageMetadata('msg-1', meta1)
    useWaggleStore.getState().trackMessageMetadata('msg-1', meta2)

    expect(useWaggleStore.getState().liveMessageMetadata['msg-1']).toBe(meta2)
  })

  it('returns all state to initial defaults', () => {
    useWaggleStore.getState().startCollaboration(SessionId('session-reset'), makeConfig())
    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'turn-start', turnNumber: 1, agentIndex: 1, agentLabel: 'Reviewer' })
    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'file-conflict', warning: makeFileConflict('x.ts') })
    useWaggleStore.getState().trackMessageMetadata('msg-1', makeMessageMetadata())

    useWaggleStore.getState().reset()

    const state = useWaggleStore.getState()
    expect(state.activeCollaborationId).toBeNull()
    expect(state.activeConfig).toBeNull()
    expect(state.status).toBe('idle')
    expect(state.currentTurn).toBe(0)
    expect(state.currentAgentIndex).toBe(0)
    expect(state.currentAgentLabel).toBe('')
    expect(state.initialTurnMeta).toBeNull()
    expect(state.completedTurnMeta).toEqual([])
    expect(state.liveMessageMetadata).toEqual({})
    expect(state.fileConflicts).toEqual([])
    expect(state.lastConsensusResult).toBeNull()
    expect(state.completionReason).toBeNull()
  })

  it('tracks a complete collaboration from start to consensus completion', () => {
    useWaggleStore.getState().startCollaboration(SessionId('session-lifecycle'), makeConfig())
    useWaggleStore.getState().handleTurnEvent({
      type: 'turn-start',
      turnNumber: 1,
      agentIndex: 0,
      agentLabel: 'Architect',
    })
    useWaggleStore.getState().trackMessageMetadata('msg-t1', makeMessageMetadata())
    useWaggleStore.getState().handleTurnEvent({
      type: 'turn-end',
      turnNumber: 1,
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: ARCHITECT_MODEL,
    })
    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'turn-start', turnNumber: 2, agentIndex: 1, agentLabel: 'Reviewer' })
    useWaggleStore.getState().handleTurnEvent({
      type: 'turn-end',
      turnNumber: 2,
      agentIndex: 1,
      agentLabel: 'Reviewer',
      agentColor: 'amber',
      agentModel: REVIEWER_MODEL,
    })
    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'consensus-reached', result: makeConsensusResult(true) })
    useWaggleStore.getState().handleTurnEvent({
      type: 'collaboration-complete',
      reason: 'Consensus reached',
      totalTurns: 2,
    })

    const finalState = useWaggleStore.getState()
    expect(finalState.status).toBe('completed')
    expect(finalState.completionReason).toBe('Consensus reached')
    expect(finalState.completedTurnMeta).toHaveLength(2)
    expect(finalState.lastConsensusResult?.reached).toBe(true)
  })
})
