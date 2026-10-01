import { FollowUpId, RunId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { planFollowUpPromotion } from '../follow-up-promotion'
import { applyAdaptiveMessage } from '../message-aggregate'
import { applyQueueMutation } from '../queue-aggregate'
import { settleAndScheduleNextFollowUp } from '../run-lifecycle'
import { followUp, HOLD, NEXT_RUN, state } from './follow-up-edit.test-fixtures'

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
      state: state([followUp('first', {}, { editHold: HOLD })], { state: 'idle' }, 'paused'),
      mutation: { type: 'resume', expectedRevision: 4 },
      nextRunId: NEXT_RUN,
    })
    expect(result).toMatchObject({
      accepted: true,
      outcome: { effect: 'queue-updated', queueState: 'running' },
      state: { run: { state: 'idle' } },
    })
  })

  it('queues a new message behind a held head of an idle Session', () => {
    const result = applyAdaptiveMessage({
      state: state([followUp('first', {}, { editHold: HOLD })], { state: 'idle' }),
      identities: { runId: NEXT_RUN, followUpId: FollowUpId('new') },
      intent: followUp('new').intent,
    })
    expect(result).toMatchObject({ accepted: true, outcome: { effect: 'queued-follow-up' } })
    expect(result.state.followUpQueue.items.map((item) => item.id)).toEqual(['first', 'new'])
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
})
