import { toWaggleInvocation } from '@shared/schemas/waggle'
import { FollowUpId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { beginFollowUpEdit, cancelFollowUpEdit, saveFollowUpEdit } from '../follow-up-edit'
import type { SessionControlSessionState } from '../message-aggregate'
import { AGENT, followUp, HOLD, NEXT_RUN, state, USER } from './follow-up-edit.test-fixtures'

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

describe('Follow-up edit', () => {
  it('holds the caller’s own Follow-up in place and reports the hold', () => {
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
    expect(result.state.followUpQueue.items[0]?.editHold).toEqual(HOLD)
  })

  it('refuses to edit another caller’s Follow-up, including one re-authorized for someone else', () => {
    expect(begin(state([followUp('first', { callerId: AGENT })]))).toMatchObject({
      accepted: false,
      code: 'follow_up_not_editable',
    })
    expect(
      begin(state([followUp('first', { callerId: USER, authorCallerId: AGENT })])),
    ).toMatchObject({ accepted: false, code: 'follow_up_not_editable' })
    expect(
      begin(state([followUp('first', { callerId: AGENT, authorCallerId: USER })])),
    ).toMatchObject({ accepted: false, code: 'follow_up_not_editable' })
  })

  it('refuses a second hold and a missing Follow-up', () => {
    expect(begin(state([followUp('first', {}, { editHold: HOLD })]))).toMatchObject({
      accepted: false,
      code: 'follow_up_edit_held',
    })
    expect(begin(state([followUp('first')]), 'missing')).toMatchObject({
      accepted: false,
      code: 'follow_up_not_found',
    })
  })

  it('replaces only the message content on save and keeps identity, position, provenance, and run settings', () => {
    const held = state([followUp('first'), followUp('second', {}, { editHold: HOLD })])

    const result = saveFollowUpEdit({
      state: held,
      followUpId: FollowUpId('second'),
      callerId: USER,
      holdId: 'hold-1',
      expectedQueueRevision: 4,
      content: { text: 'Rewritten', attachmentIds: ['attachment-2'] },
      nextRunId: NEXT_RUN,
    })

    if (!result.accepted) throw new Error(`save rejected: ${result.code}`)
    expect(result.outcome).toMatchObject({ operation: 'queue-edit-save', effect: 'queue-updated' })
    const saved = result.state.followUpQueue.items[1]
    expect(result.state.followUpQueue.items.map((item) => item.id)).toEqual(['first', 'second'])
    expect(saved?.editHold).toBeUndefined()
    expect(saved?.intent).toEqual({
      text: 'Rewritten',
      attachmentIds: ['attachment-2'],
      thinkingLevel: 'high',
      runAuthorizationOverride: 'ask-for-approval',
      callerId: USER,
      acceptedAt: 500,
      idempotencyKey: 'key-second',
    })
  })

  it('adds and removes a Waggle invocation and a visualization context', () => {
    const waggle = toWaggleInvocation({
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
    const withWaggle = saveFollowUpEdit({
      state: state([followUp('first', {}, { editHold: HOLD })]),
      followUpId: FollowUpId('first'),
      callerId: USER,
      holdId: 'hold-1',
      expectedQueueRevision: 4,
      content: { text: 'With Waggle', attachmentIds: [], waggle },
      nextRunId: NEXT_RUN,
    })
    if (!withWaggle.accepted) throw new Error('save rejected')
    expect(withWaggle.state.followUpQueue.items[0]?.intent.waggle).toEqual(waggle)

    const removed = saveFollowUpEdit({
      state: state([
        followUp(
          'first',
          {
            waggle,
            visualizationContext: { title: 'Chart', sourcePath: '/tmp/chart.html', state: null },
          },
          { editHold: HOLD },
        ),
      ]),
      followUpId: FollowUpId('first'),
      callerId: USER,
      holdId: 'hold-1',
      expectedQueueRevision: 4,
      content: { text: 'Plain', attachmentIds: [] },
      nextRunId: NEXT_RUN,
    })
    if (!removed.accepted) throw new Error('save rejected')
    expect(removed.state.followUpQueue.items[0]?.intent).not.toHaveProperty('visualizationContext')
    expect(removed.state.followUpQueue.items[0]?.intent).not.toHaveProperty('waggle')
  })

  it('guards save by queue revision and by the hold it names', () => {
    const held = state([followUp('first', {}, { editHold: HOLD })])
    const save = (overrides: Partial<Parameters<typeof saveFollowUpEdit>[0]>) =>
      saveFollowUpEdit({
        state: held,
        followUpId: FollowUpId('first'),
        callerId: USER,
        holdId: 'hold-1',
        expectedQueueRevision: 4,
        content: { text: 'x', attachmentIds: [] },
        nextRunId: NEXT_RUN,
        ...overrides,
      })
    expect(save({ expectedQueueRevision: 3 })).toMatchObject({ code: 'queue_revision_changed' })
    expect(save({ holdId: 'hold-other' })).toMatchObject({ code: 'follow_up_edit_hold_mismatch' })
    expect(save({ state: state([followUp('first')]) })).toMatchObject({
      code: 'follow_up_edit_not_held',
    })
    expect(save({ followUpId: FollowUpId('gone') })).toMatchObject({
      code: 'follow_up_not_found',
    })
    expect(
      save({ content: { text: 'x'.repeat(33 * 1024 * 1024), attachmentIds: [] } }),
    ).toMatchObject({ code: 'queue_byte_capacity_reached' })
  })

  it('starts the head when releasing the hold leaves an idle Session with a runnable queue', () => {
    const idleHeld = state([followUp('first', {}, { editHold: HOLD }), followUp('second')], {
      state: 'idle',
    })
    const saved = saveFollowUpEdit({
      state: idleHeld,
      followUpId: FollowUpId('first'),
      callerId: USER,
      holdId: 'hold-1',
      expectedQueueRevision: 4,
      content: { text: 'Now send this', attachmentIds: [] },
      nextRunId: NEXT_RUN,
    })
    if (!saved.accepted) throw new Error('save rejected')
    expect(saved.outcome).toMatchObject({
      operation: 'queue-edit-save',
      effect: 'started-run',
      runId: NEXT_RUN,
      followUpId: 'first',
    })
    expect(saved.state.run).toMatchObject({ state: 'starting', intent: { text: 'Now send this' } })
    expect(saved.state.followUpQueue.items.map((item) => item.id)).toEqual(['second'])

    const cancelled = cancelFollowUpEdit({
      state: idleHeld,
      followUpId: FollowUpId('first'),
      holdId: 'hold-1',
      nextRunId: NEXT_RUN,
    })
    expect(cancelled).toMatchObject({
      accepted: true,
      outcome: { operation: 'queue-edit-cancel', effect: 'started-run', followUpId: 'first' },
    })
  })

  it('does not start a Run on release while paused, active, or still held further up', () => {
    const release = (input: SessionControlSessionState) =>
      cancelFollowUpEdit({
        state: input,
        followUpId: FollowUpId('second'),
        holdId: 'hold-1',
        nextRunId: NEXT_RUN,
      })
    const otherHold = { ...HOLD, holdId: 'hold-2' }
    expect(
      release(
        state(
          [followUp('first'), followUp('second', {}, { editHold: HOLD })],
          { state: 'idle' },
          'paused',
        ),
      ),
    ).toMatchObject({ outcome: { effect: 'queue-updated', queueState: 'paused' } })
    expect(
      release(state([followUp('first'), followUp('second', {}, { editHold: HOLD })])),
    ).toMatchObject({ outcome: { effect: 'queue-updated' } })
    expect(
      release(
        state(
          [
            followUp('first', {}, { editHold: otherHold }),
            followUp('second', {}, { editHold: HOLD }),
          ],
          { state: 'idle' },
        ),
      ),
    ).toMatchObject({ outcome: { effect: 'queue-updated' } })
  })

  it('releases a gone hold successfully but refuses another window’s hold', () => {
    expect(
      cancelFollowUpEdit({
        state: state([followUp('first')]),
        followUpId: FollowUpId('first'),
        holdId: 'hold-1',
        nextRunId: NEXT_RUN,
      }),
    ).toMatchObject({ accepted: true, outcome: { effect: 'queue-updated', queueRevision: 4 } })
    expect(
      cancelFollowUpEdit({
        state: state([followUp('first', {}, { editHold: HOLD })]),
        followUpId: FollowUpId('first'),
        holdId: 'hold-other',
        nextRunId: NEXT_RUN,
      }),
    ).toMatchObject({ accepted: false, code: 'follow_up_edit_hold_mismatch' })
  })
})
