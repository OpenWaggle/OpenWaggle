import { toWaggleInvocation } from '@shared/schemas/waggle'
import { FollowUpId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  beginFollowUpEdit,
  cancelFollowUpEdit,
  canEditFollowUp,
  saveFollowUpEdit,
} from '../follow-up-edit'
import type { SessionControlSessionState } from '../message-aggregate'
import { AGENT, followUp, HOLD, state, USER } from './follow-up-edit.test-fixtures'

function begin(input: SessionControlSessionState, followUpId = 'first', callerId = USER) {
  return beginFollowUpEdit({
    state: input,
    followUpId: FollowUpId(followUpId),
    callerId,
    holdId: 'hold-1',
    acquiredAt: 1_000,
    leaseMs: 30_000,
  })
}

function save(overrides: Partial<Parameters<typeof saveFollowUpEdit>[0]> = {}) {
  return saveFollowUpEdit({
    state: state([followUp('first'), followUp('second', {}, { editHold: HOLD })]),
    followUpId: FollowUpId('second'),
    callerId: USER,
    holdId: 'hold-1',
    expectedQueueRevision: HOLD.baseQueueRevision,
    content: { text: 'Rewritten', attachmentIds: ['attachment-2'] },
    ...overrides,
  })
}

const WAGGLE = toWaggleInvocation({
  presetId: 'preset',
  presetName: 'Cross-check',
  source: 'user',
  config: {
    mode: 'sequential',
    agents: [
      { label: 'A', model: '$inherit', roleDescription: 'a', color: 'blue' },
      { label: 'B', model: 'openai/gpt-5', roleDescription: 'b', color: 'amber' },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  },
})
const CHART = { title: 'Chart', sourcePath: '/tmp/chart.html', state: null }

describe('Follow-up edit', () => {
  it('holds the caller’s own Follow-up in place, with a fresh sweep-counted lease', () => {
    const result = begin(state([followUp('first'), followUp('second')]))

    expect(result).toMatchObject({
      accepted: true,
      outcome: {
        operation: 'queue-edit-begin',
        effect: 'follow-up-edit-held',
        followUpId: 'first',
        holdId: 'hold-1',
        leaseExpiresAt: 31_000,
        queueRevision: 5,
        stateRevision: 11,
      },
    })
    if (!result.accepted) throw new Error('expected a hold')
    expect(result.state.followUpQueue.items.map((item) => item.id)).toEqual(['first', 'second'])
    expect(result.state.followUpQueue.items[0]?.editHold).toEqual({
      holdId: 'hold-1',
      holderCallerId: USER,
      acquiredAt: 1_000,
      missedSweeps: 0,
      baseQueueRevision: 5,
    })
  })

  it('lets only the caller that queued a Follow-up edit it', () => {
    expect(canEditFollowUp({ callerId: USER }, USER)).toBe(true)
    expect(canEditFollowUp({ callerId: AGENT }, USER)).toBe(false)
    expect(begin(state([followUp('first', { callerId: AGENT })]))).toMatchObject({
      accepted: false,
      code: 'follow_up_not_editable',
    })
  })

  it('refuses a second hold and a missing Follow-up', () => {
    expect(begin(state([followUp('first', {}, { editHold: HOLD })]))).toMatchObject({
      code: 'follow_up_edit_held',
    })
    expect(begin(state([followUp('first')]), 'missing')).toMatchObject({
      code: 'follow_up_not_found',
    })
  })

  it('replaces only the content and keeps identity, position, and provenance', () => {
    const result = save()

    if (!result.accepted) throw new Error(`save rejected: ${result.code}`)
    expect(result.outcome).toMatchObject({ operation: 'queue-edit-save', effect: 'queue-updated' })
    expect(result.state.followUpQueue.items.map((item) => item.id)).toEqual(['first', 'second'])
    expect(result.state.followUpQueue.items[1]?.editHold).toBeUndefined()
    expect(result.state.followUpQueue.items[1]?.intent).toEqual({
      text: 'Rewritten',
      attachmentIds: ['attachment-2'],
      callerId: USER,
      acceptedAt: 500,
      idempotencyKey: 'key-second',
    })
  })

  it('adds and removes a Waggle invocation and a visualization context', () => {
    const added = save({
      content: {
        text: 'With Waggle',
        attachmentIds: [],
        waggle: WAGGLE,
        visualizationContext: CHART,
      },
    })
    if (!added.accepted) throw new Error('save rejected')
    expect(added.state.followUpQueue.items[1]?.intent).toMatchObject({
      waggle: WAGGLE,
      visualizationContext: CHART,
    })

    const removed = save({
      state: state([
        followUp('second', { waggle: WAGGLE, visualizationContext: CHART }, { editHold: HOLD }),
      ]),
      content: { text: 'Plain', attachmentIds: [] },
    })
    if (!removed.accepted) throw new Error('save rejected')
    expect(removed.state.followUpQueue.items[0]?.intent).not.toHaveProperty('waggle')
    expect(removed.state.followUpQueue.items[0]?.intent).not.toHaveProperty('visualizationContext')
  })

  it('guards a save by the revision its edit began at, not by unrelated queue changes', () => {
    const reorderedSince = state(
      [followUp('second', {}, { editHold: HOLD }), followUp('first')],
      undefined,
      'running',
      { revision: 9 },
    )
    expect(save({ state: reorderedSince })).toMatchObject({ accepted: true })
    expect(save({ expectedQueueRevision: 9 })).toMatchObject({ code: 'queue_revision_changed' })
  })

  it('refuses a save whose hold is gone, belongs to another edit, or overflows the queue', () => {
    expect(save({ holdId: 'hold-other' })).toMatchObject({ code: 'follow_up_edit_hold_mismatch' })
    expect(save({ state: state([followUp('second')]) })).toMatchObject({
      code: 'follow_up_edit_not_held',
    })
    expect(save({ followUpId: FollowUpId('gone') })).toMatchObject({ code: 'follow_up_not_found' })
    expect(
      save({ content: { text: 'x'.repeat(33 * 1024 * 1024), attachmentIds: [] } }),
    ).toMatchObject({ code: 'queue_byte_capacity_reached' })
  })

  it('lets an edit shrink an item of a queue that returned steers pushed past its byte cap', () => {
    const large = 'x'.repeat(20 * 1024 * 1024)
    const overCap = state([
      followUp('first', { text: large }),
      followUp('second', { text: large }, { editHold: HOLD }),
    ])
    expect(save({ state: overCap, content: { text: 'Shorter', attachmentIds: [] } })).toMatchObject(
      {
        accepted: true,
      },
    )
    expect(
      save({ state: overCap, content: { text: `${large}!`, attachmentIds: [] } }),
    ).toMatchObject({ code: 'queue_byte_capacity_reached' })
  })

  it('accepts cancelling a gone hold as a no-op, but refuses another edit’s hold', () => {
    expect(
      cancelFollowUpEdit({
        state: state([followUp('first')]),
        followUpId: FollowUpId('first'),
        holdId: 'hold-1',
      }),
    ).toMatchObject({ accepted: true, outcome: { effect: 'queue-updated', queueRevision: 4 } })
    const released = cancelFollowUpEdit({
      state: state([followUp('first', {}, { editHold: HOLD })]),
      followUpId: FollowUpId('first'),
      holdId: 'hold-1',
    })
    expect(released.accepted && released.state.followUpQueue.items[0]?.editHold).toBeFalsy()
    expect(
      cancelFollowUpEdit({
        state: state([followUp('first', {}, { editHold: HOLD })]),
        followUpId: FollowUpId('first'),
        holdId: 'hold-other',
      }),
    ).toMatchObject({ accepted: false, code: 'follow_up_edit_hold_mismatch' })
  })
})
