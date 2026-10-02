import { FollowUpId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { adoptFollowUp } from '../follow-up-adopt'
import { AGENT, followUp, HOLD, state, USER } from './follow-up-edit.test-fixtures'

const PROFILE = 'profile:ci'

function revoked(id: string, callerId = PROFILE) {
  return followUp(
    id,
    { callerId },
    { deliveryState: 'needs_attention', attentionReason: 'profile_revoked' },
  )
}

describe('adoptFollowUp', () => {
  it('re-authors a needs-attention Follow-up as the adopter and keeps who queued it', () => {
    const before = state([followUp('first'), revoked('stuck'), followUp('last')])

    const result = adoptFollowUp({
      state: before,
      followUpId: FollowUpId('stuck'),
      callerId: USER,
      expectedQueueRevision: 4,
    })

    if (!result.accepted) throw new Error(`Refused: ${result.code}`)
    const adopted = result.state.followUpQueue.items[1]
    expect(adopted).toEqual({
      id: 'stuck',
      deliveryState: 'pending',
      intent: { ...revoked('stuck').intent, callerId: USER, authorCallerId: PROFILE },
    })
    // Same identity and position; the queue revision moves like every queue change.
    expect(result.state.followUpQueue.items.map((item) => item.id)).toEqual([
      'first',
      'stuck',
      'last',
    ])
    expect(result.outcome).toMatchObject({
      operation: 'queue-adopt',
      effect: 'queue-updated',
      queueRevision: 5,
      stateRevision: 11,
    })
    expect(adopted?.intent).not.toHaveProperty('runAuthorizationOverride')
  })

  it('keeps the first author through a second adoption, and records none for its own Follow-up', () => {
    const twice = adoptFollowUp({
      state: state([
        revoked('stuck', AGENT),
        followUp(
          'mine',
          {},
          { deliveryState: 'needs_attention', attentionReason: 'authority_changed' },
        ),
      ]),
      followUpId: FollowUpId('stuck'),
      callerId: USER,
      expectedQueueRevision: 4,
    })
    if (!twice.accepted) throw new Error(twice.code)
    const own = adoptFollowUp({
      state: twice.state,
      followUpId: FollowUpId('mine'),
      callerId: USER,
      expectedQueueRevision: 5,
    })

    if (!own.accepted) throw new Error(own.code)
    expect(own.state.followUpQueue.items[0]?.intent).toMatchObject({
      callerId: USER,
      authorCallerId: AGENT,
    })
    expect(own.state.followUpQueue.items[1]?.intent).not.toHaveProperty('authorCallerId')
  })

  it("ends another caller's edit hold but keeps the adopter's own", () => {
    const foreign = adoptFollowUp({
      state: state([
        { ...revoked('stuck'), editHold: { ...HOLD, holderCallerId: AGENT } },
        { ...revoked('held'), editHold: { ...HOLD, holdId: 'hold-2' } },
      ]),
      followUpId: FollowUpId('stuck'),
      callerId: USER,
      expectedQueueRevision: 4,
    })
    if (!foreign.accepted) throw new Error(foreign.code)
    expect(foreign.state.followUpQueue.items[0]).not.toHaveProperty('editHold')

    const own = adoptFollowUp({
      state: foreign.state,
      followUpId: FollowUpId('held'),
      callerId: USER,
      expectedQueueRevision: 5,
    })
    if (!own.accepted) throw new Error(own.code)
    expect(own.state.followUpQueue.items[1]?.editHold).toMatchObject({ holdId: 'hold-2' })
  })

  it.each([
    ['a stale queue revision', 'stuck', 3, 'queue_revision_changed'],
    ['a Follow-up that is gone', 'missing', 4, 'follow_up_not_found'],
    ['a deliverable Follow-up', 'first', 4, 'follow_up_not_adoptable'],
  ] as const)('refuses %s', (_case, id, revision, code) => {
    const before = state([followUp('first'), revoked('stuck')])

    const result = adoptFollowUp({
      state: before,
      followUpId: FollowUpId(id),
      callerId: USER,
      expectedQueueRevision: revision,
    })

    expect(result).toMatchObject({ accepted: false, code, state: before })
  })
})
