import { SessionId } from '@shared/types/brand'
import type { WaggleTurnEvent } from '@shared/types/waggle'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWaggleStore } from '../waggle-store'
import {
  ARCHITECT_MODEL,
  itemAt,
  makeConfig,
  makeConsensusResult,
  makeFileConflict,
  REVIEWER_MODEL,
} from './waggle-store.test-utils'

describe('waggle-store turn event behavior', () => {
  beforeEach(() => {
    useWaggleStore.getState().reset()
    useWaggleStore.getState().startCollaboration(SessionId('session-events'), makeConfig())
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
    useWaggleStore.getState().handleTurnEvent({
      type: 'turn-end',
      turnNumber: 1,
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: ARCHITECT_MODEL,
    })

    const meta = useWaggleStore.getState().completedTurnMeta
    expect(meta).toHaveLength(1)
    expect(itemAt(meta, 0).agentLabel).toBe('Architect')
    expect(itemAt(meta, 0).agentColor).toBe('blue')
    expect(itemAt(meta, 0).turnNumber).toBe(1)
  })

  it('handles consensus-reached by storing the result', () => {
    const result = makeConsensusResult(true)

    useWaggleStore.getState().handleTurnEvent({ type: 'consensus-reached', result })

    expect(useWaggleStore.getState().lastConsensusResult).toBe(result)
  })

  it('accumulates file conflicts', () => {
    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'file-conflict', warning: makeFileConflict('a.ts') })
    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'file-conflict', warning: makeFileConflict('b.ts') })

    const conflicts = useWaggleStore.getState().fileConflicts
    expect(conflicts).toHaveLength(2)
    expect(itemAt(conflicts, 0).path).toBe('a.ts')
  })

  it('sets terminal status and reason when collaboration completes or stops', () => {
    useWaggleStore.getState().handleTurnEvent({
      type: 'collaboration-complete',
      reason: 'Consensus reached after 4 turns',
      totalTurns: 4,
    })
    expect(useWaggleStore.getState().status).toBe('completed')
    expect(useWaggleStore.getState().completionReason).toBe('Consensus reached after 4 turns')

    useWaggleStore
      .getState()
      .handleTurnEvent({ type: 'collaboration-stopped', reason: 'User cancelled' })
    expect(useWaggleStore.getState().status).toBe('stopped')
    expect(useWaggleStore.getState().completionReason).toBe('User cancelled')
  })

  it('accumulates completed turn metadata across multiple turn-end events', () => {
    useWaggleStore.getState().handleTurnEvent({
      type: 'turn-end',
      turnNumber: 1,
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: ARCHITECT_MODEL,
    })
    useWaggleStore.getState().handleTurnEvent({
      type: 'turn-end',
      turnNumber: 2,
      agentIndex: 1,
      agentLabel: 'Reviewer',
      agentColor: 'amber',
      agentModel: REVIEWER_MODEL,
    })

    const meta = useWaggleStore.getState().completedTurnMeta
    expect(meta).toHaveLength(2)
    expect(itemAt(meta, 0).agentLabel).toBe('Architect')
    expect(itemAt(meta, 1).agentLabel).toBe('Reviewer')
  })
})
