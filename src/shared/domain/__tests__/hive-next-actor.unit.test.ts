import { describe, expect, it } from 'vitest'
import { hiveNextActor } from '../hive-next-actor'

describe('hiveNextActor', () => {
  it('puts a parked approval or question first, whatever the Delegation state', () => {
    expect(hiveNextActor({ delegationState: 'working', pendingRequest: 'approval' })).toEqual({
      nextActor: 'user',
      reason: 'awaiting-approval',
    })
    expect(hiveNextActor({ delegationState: 'accepted', pendingRequest: 'question' })).toEqual({
      nextActor: 'user',
      reason: 'awaiting-answer',
    })
  })

  it('covers the Queen, which has no Delegation, only through her own parked request', () => {
    expect(hiveNextActor({ pendingRequest: 'approval' })?.nextActor).toBe('user')
    expect(hiveNextActor({})).toBeNull()
    expect(hiveNextActor({ delegationState: null, parentWillAct: true })).toBeNull()
  })

  it('keeps a Worker revising at the parent’s request with the Worker', () => {
    expect(hiveNextActor({ delegationState: 'revision_requested' })).toEqual({
      nextActor: 'worker',
      reason: 'revising',
    })
  })

  it('sends a failed Run to the parent only while the parent will pick it up', () => {
    const failed = { delegationState: 'needs_attention', attentionCause: 'run_failed' } as const
    expect(hiveNextActor({ ...failed, parentWillAct: true })).toEqual({
      nextActor: 'parent',
      reason: 'run-failed',
    })
    expect(hiveNextActor({ ...failed, parentWillAct: false })).toEqual({
      nextActor: 'user',
      reason: 'stuck',
    })
    // A legacy row with no recorded cause reads as a failed Run.
    expect(hiveNextActor({ delegationState: 'needs_attention', parentWillAct: true })?.reason).toBe(
      'run-failed',
    )
  })

  it('names a Worker’s own request for help, and its stuck form', () => {
    const asked = { delegationState: 'needs_attention', attentionCause: 'worker_request' } as const
    expect(hiveNextActor({ ...asked, parentWillAct: true })).toEqual({
      nextActor: 'parent',
      reason: 'asked-for-help',
    })
    expect(hiveNextActor(asked)).toEqual({ nextActor: 'user', reason: 'stuck' })
  })

  it('maps every other state to its next actor', () => {
    expect(hiveNextActor({ delegationState: 'ready_for_review' })).toEqual({
      nextActor: 'parent',
      reason: 'ready-for-review',
    })
    expect(hiveNextActor({ delegationState: 'waiting' })).toEqual({
      nextActor: 'parent',
      reason: 'finished-turn',
    })
    expect(hiveNextActor({ delegationState: 'working' })).toEqual({
      nextActor: 'worker',
      reason: 'working',
    })
    expect(hiveNextActor({ delegationState: 'working', connecting: true })?.reason).toBe(
      'connecting',
    )
    expect(hiveNextActor({ delegationState: 'accepted' })).toEqual({
      nextActor: 'none',
      reason: 'accepted',
    })
    expect(hiveNextActor({ delegationState: 'cancelled' })).toEqual({
      nextActor: 'none',
      reason: 'cancelled',
    })
  })

  it('never routes ready-for-review or a closed Delegation to the user without a request', () => {
    for (const delegationState of ['ready_for_review', 'waiting', 'accepted'] as const) {
      expect(hiveNextActor({ delegationState, parentWillAct: false })?.nextActor).not.toBe('user')
    }
  })
})
