import { FollowUpId, RunId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  deliverIdleQueueHead,
  pauseUndeliveredQueue,
  waitsOnHeldNextFollowUp,
} from '../follow-up-delivery'
import { planFollowUpPromotion } from '../follow-up-promotion'
import { applyAdaptiveMessage } from '../message-aggregate'
import { applyQueueMutation } from '../queue-aggregate'
import { settleAndScheduleNextFollowUp } from '../run-lifecycle'
import { followUp, HOLD, IDLE, NEXT_RUN, state, USER } from './follow-up-edit.test-fixtures'

describe('Follow-up edit hold delivery', () => {
  it('stops settlement at a held head but delivers items ahead of a held one', () => {
    const heldHead = settleAndScheduleNextFollowUp(
      state([followUp('first', {}, { editHold: HOLD }), followUp('second')]),
      RunId('run-active'),
      NEXT_RUN,
    )
    expect(heldHead).toMatchObject({ accepted: true, state: { run: { state: 'idle' } } })
    expect(heldHead.accepted && heldHead.scheduled).toBeFalsy()

    const heldSecond = settleAndScheduleNextFollowUp(
      state([followUp('first'), followUp('second', {}, { editHold: HOLD })]),
      RunId('run-active'),
      NEXT_RUN,
    )
    expect(heldSecond).toMatchObject({ accepted: true, scheduled: { followUpId: 'first' } })
  })

  it('resumes a queue without starting a held head', () => {
    const result = applyQueueMutation({
      state: state([followUp('first', {}, { editHold: HOLD })], IDLE, 'paused'),
      mutation: { type: 'resume', expectedRevision: 4 },
      nextRunId: NEXT_RUN,
    })
    expect(result).toMatchObject({
      accepted: true,
      outcome: { effect: 'queue-updated', queueState: 'running' },
      state: { run: { state: 'idle' } },
    })
  })

  it('queues a new message behind the held head of a running queue', () => {
    const result = applyAdaptiveMessage({
      state: state([followUp('first', {}, { editHold: HOLD })], IDLE),
      identities: { runId: NEXT_RUN, followUpId: FollowUpId('new') },
      intent: followUp('new').intent,
    })
    expect(result).toMatchObject({ accepted: true, outcome: { effect: 'queued-follow-up' } })
    expect(result.state.followUpQueue.items.map((item) => item.id)).toEqual(['first', 'new'])
  })

  it('starts a new message when the queue with a held head is paused', () => {
    const result = applyAdaptiveMessage({
      state: state([followUp('first', {}, { editHold: HOLD })], IDLE, 'paused'),
      identities: { runId: NEXT_RUN, followUpId: FollowUpId('new') },
      intent: followUp('new').intent,
    })
    expect(result).toMatchObject({ accepted: true, outcome: { effect: 'started-run' } })
  })

  it('refuses to steer a held Follow-up', () => {
    expect(
      planFollowUpPromotion({
        requestedRunId: RunId('run-active'),
        followUpId: FollowUpId('first'),
        run: { state: 'active', runId: RunId('run-active'), acceptsSteering: true },
        followUpQueue: { items: [FollowUpId('first')], heldItems: [FollowUpId('first')] },
      }),
    ).toEqual({ accepted: false, code: 'follow_up_edit_held' })
  })

  it('keeps the hold on its item when the queue is reordered', () => {
    const result = applyQueueMutation({
      state: state([followUp('first', {}, { editHold: HOLD }), followUp('second')]),
      mutation: {
        type: 'reorder',
        expectedRevision: 4,
        orderedFollowUpIds: [FollowUpId('second'), FollowUpId('first')],
      },
      nextRunId: NEXT_RUN,
    })
    if (!result.accepted) throw new Error('reorder rejected')
    expect(result.state.followUpQueue.items[1]).toMatchObject({ id: 'first', editHold: HOLD })
  })

  it('ends the hold when another caller re-authorizes the Follow-up, not when its editor does', () => {
    const reauthorize = (callerId: string) =>
      applyQueueMutation({
        state: state([followUp('first', {}, { editHold: HOLD })]),
        mutation: {
          type: 'update-authorization',
          followUpId: FollowUpId('first'),
          callerId,
          runAuthorizationOverride: null,
        },
        nextRunId: NEXT_RUN,
      })
    const byOther = reauthorize('local-user:machine')
    const byEditor = reauthorize(USER)
    expect(byOther.accepted && byOther.state.followUpQueue.items[0]?.editHold).toBeFalsy()
    expect(byEditor.accepted && byEditor.state.followUpQueue.items[0]?.editHold).toEqual(HOLD)
  })

  it('waits on an edit only when a running queue’s next Follow-up is held', () => {
    const held = followUp('first', {}, { editHold: HOLD })
    expect(waitsOnHeldNextFollowUp(state([held]))).toBe(true)
    expect(waitsOnHeldNextFollowUp(state([followUp('first')]))).toBe(false)
    expect(waitsOnHeldNextFollowUp(state([followUp('first'), held]))).toBe(false)
    expect(waitsOnHeldNextFollowUp(state([held], undefined, 'paused'))).toBe(false)
  })
})

describe('deliverIdleQueueHead', () => {
  it('starts the pending head of an idle running queue once nothing holds it', () => {
    const delivery = deliverIdleQueueHead(
      state([followUp('first'), followUp('second')], IDLE),
      NEXT_RUN,
    )
    expect(delivery.delivered).toMatchObject({ followUpId: 'first', runId: NEXT_RUN })
    expect(delivery.state).toMatchObject({
      revision: 11,
      run: { state: 'starting', runId: NEXT_RUN },
      followUpQueue: { revision: 5 },
    })
    expect(delivery.state.followUpQueue.items.map((item) => item.id)).toEqual(['second'])
  })

  it('leaves a held, paused, attention-needing, or busy queue as it is', () => {
    const cases = [
      state([followUp('first', {}, { editHold: HOLD })], IDLE),
      state([followUp('first')], IDLE, 'paused'),
      state([followUp('first', {}, { deliveryState: 'needs_attention' })], IDLE),
      state([followUp('first')]),
    ]
    for (const input of cases) {
      expect(deliverIdleQueueHead(input, NEXT_RUN)).toEqual({ state: input })
    }
  })

  it('starts a failed Run’s retry that waited behind a hold once the hold is gone', () => {
    const waiting = state(
      [
        followUp('earlier', { acceptedAt: 100 }, { editHold: HOLD }),
        followUp('retry', { acceptedAt: 300 }),
      ],
      IDLE,
      'paused',
      { deferredRetryAfter: 200 },
    )
    expect(deliverIdleQueueHead(waiting, NEXT_RUN)).toEqual({ state: waiting })

    const released = state(
      [followUp('earlier', { acceptedAt: 100 }), followUp('retry', { acceptedAt: 300 })],
      IDLE,
      'paused',
      { deferredRetryAfter: 200 },
    )
    const delivery = deliverIdleQueueHead(released, NEXT_RUN)
    expect(delivery.delivered).toMatchObject({ followUpId: 'retry' })
    expect(delivery.state.followUpQueue).toMatchObject({ state: 'paused' })
    expect(delivery.state.followUpQueue).not.toHaveProperty('deferredRetryAfter')
    expect(delivery.state.followUpQueue.items.map((item) => item.id)).toEqual(['earlier'])
  })

  it('drops a deferred retry whose Follow-up is gone', () => {
    const delivery = deliverIdleQueueHead(
      state([followUp('earlier', { acceptedAt: 100 })], IDLE, 'paused', {
        deferredRetryAfter: 200,
      }),
      NEXT_RUN,
    )
    expect(delivery.delivered).toBeUndefined()
    expect(delivery.state.followUpQueue).not.toHaveProperty('deferredRetryAfter')
  })

  it('pauses a queue whose delivery the Host cannot admit, with a reason older binaries decode', () => {
    expect(pauseUndeliveredQueue(state([followUp('first')], IDLE)).followUpQueue).toEqual({
      state: 'paused',
      revision: 5,
      items: [followUp('first')],
    })
    expect(
      pauseUndeliveredQueue(state([followUp('first')], IDLE), 'parent-limit').followUpQueue,
    ).toMatchObject({ state: 'paused', pauseReason: 'parent-limit' })
  })
})
