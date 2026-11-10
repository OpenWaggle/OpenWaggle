import { describe, expect, it } from 'vitest'
import { deliverPersonFollowUpPastCapacity, waitsOnHeldNextFollowUp } from '../follow-up-delivery'
import { AGENT, followUp, HOLD, IDLE, NEXT_RUN, state } from './follow-up-edit.test-fixtures'

const agents = followUp('agents', { callerId: AGENT })
const mine = followUp('mine')

describe('deliverPersonFollowUpPastCapacity', () => {
  it('starts the person’s first Follow-up ahead of agents’ held at a limit', () => {
    const delivery = deliverPersonFollowUpPastCapacity(
      state([agents, mine], IDLE, 'paused', { pauseReason: 'parent-limit' }),
      NEXT_RUN,
    )

    expect(delivery.delivered).toMatchObject({ followUpId: 'mine', runId: NEXT_RUN })
    expect(delivery.state.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'agents' }],
    })
  })

  it.each([
    [
      'a queue the person paused',
      state([agents, mine], IDLE, 'paused', { pauseReason: 'requested' }),
    ],
    ['a running queue', state([agents, mine], IDLE)],
    ['a live Run', state([agents, mine], undefined, 'paused', { pauseReason: 'parent-limit' })],
    ['only agents’ work', state([agents], IDLE, 'paused', { pauseReason: 'parent-limit' })],
    [
      'an edit held ahead of it',
      state([followUp('agents', { callerId: AGENT }, { editHold: HOLD }), mine], IDLE, 'paused', {
        pauseReason: 'parent-limit',
      }),
    ],
    [
      'a failed Run’s deferred retry',
      state([agents, mine], IDLE, 'paused', { pauseReason: 'parent-limit', deferredRetryAfter: 1 }),
    ],
  ])('starts nothing for %s', (_, before) => {
    expect(deliverPersonFollowUpPastCapacity(before, NEXT_RUN).delivered).toBeUndefined()
  })

  it('skips the person’s Follow-up that needs attention for a later one', () => {
    const delivery = deliverPersonFollowUpPastCapacity(
      state(
        [agents, followUp('stuck', {}, { deliveryState: 'needs_attention' }), followUp('later')],
        IDLE,
        'paused',
        { pauseReason: 'parent-limit' },
      ),
      NEXT_RUN,
    )

    expect(delivery.delivered?.followUpId).toBe('later')
  })

  // A failed Run's agent retry was refused: only the person's own retry passes its pause.
  it('starts only the person’s retry after `retriesAfter`, keeping the queue’s reason', () => {
    const delivery = deliverPersonFollowUpPastCapacity(
      state(
        [
          followUp('earlier', { acceptedAt: 1 }),
          followUp('agent-retry', { callerId: AGENT, acceptedAt: 11 }),
          followUp('retry', { acceptedAt: 12 }),
        ],
        IDLE,
        'paused',
        { pauseReason: 'run-failed' },
      ),
      NEXT_RUN,
      10,
    )

    expect(delivery.delivered?.followUpId).toBe('retry')
    expect(delivery.state.followUpQueue).toMatchObject({ pauseReason: 'run-failed' })
  })
})

// A Worker's Delegation waits while the person's Follow-up will start once the edit ends.
describe('waitsOnHeldNextFollowUp in a queue waiting on agents’ capacity', () => {
  const heldMine = followUp('mine', {}, { editHold: HOLD })

  it.each([
    ['the person’s Follow-up is held', [agents, heldMine], true],
    [
      'an edit holds an item before it',
      [followUp('agents', { callerId: AGENT }, { editHold: HOLD }), mine],
      true,
    ],
    [
      'only agents’ work waits',
      [followUp('agents', { callerId: AGENT }, { editHold: HOLD })],
      false,
    ],
    ['nothing is held', [agents, mine], false],
  ] as const)('is %s: %s', (_, items, waits) => {
    expect(
      waitsOnHeldNextFollowUp(state([...items], IDLE, 'paused', { pauseReason: 'parent-limit' })),
    ).toBe(waits)
  })

  it('does not wait on a queue paused for another reason', () => {
    expect(
      waitsOnHeldNextFollowUp(
        state([agents, heldMine], IDLE, 'paused', { pauseReason: 'requested' }),
      ),
    ).toBe(false)
  })
})
