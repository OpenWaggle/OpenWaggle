import { FollowUpId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { mutateFollowUpQueue } from '../follow-up-queue'

describe('Session Control Follow-up queue', () => {
  it('appends durable intent at the tail and advances the queue revision', () => {
    const queued = { id: FollowUpId('follow-up-existing'), payload: 'first' }
    const appended = { id: FollowUpId('follow-up-new'), payload: 'second' }

    const result = mutateFollowUpQueue(
      { state: 'running', revision: 7, items: [queued] },
      { type: 'append', item: appended },
    )

    expect(result).toEqual({
      accepted: true,
      queue: { state: 'running', revision: 8, items: [queued, appended] },
    })
  })

  it('withdraws only the selected Follow-up by stable identity', () => {
    const first = { id: FollowUpId('follow-up-first'), payload: 'first' }
    const selected = { id: FollowUpId('follow-up-selected'), payload: 'second' }
    const last = { id: FollowUpId('follow-up-last'), payload: 'third' }

    const result = mutateFollowUpQueue(
      { state: 'running', revision: 9, items: [first, selected, last] },
      { type: 'withdraw', followUpIds: [selected.id] },
    )

    expect(result).toEqual({
      accepted: true,
      queue: { state: 'running', revision: 10, items: [first, last] },
    })
  })

  it('reorders pending Follow-ups by stable identity under the expected revision', () => {
    const first = { id: FollowUpId('follow-up-first'), payload: 'first' }
    const second = { id: FollowUpId('follow-up-second'), payload: 'second' }
    const third = { id: FollowUpId('follow-up-third'), payload: 'third' }

    const result = mutateFollowUpQueue(
      { state: 'running', revision: 11, items: [first, second, third] },
      {
        type: 'reorder',
        expectedRevision: 11,
        orderedFollowUpIds: [third.id, first.id, second.id],
      },
    )

    expect(result).toEqual({
      accepted: true,
      queue: { state: 'running', revision: 12, items: [third, first, second] },
    })
  })

  it('pauses automatic delivery without removing pending Follow-ups', () => {
    const pending = { id: FollowUpId('follow-up-pending'), payload: 'later' }

    const result = mutateFollowUpQueue(
      { state: 'running', revision: 15, items: [pending] },
      { type: 'pause', expectedRevision: 15 },
    )

    expect(result).toEqual({
      accepted: true,
      queue: { state: 'paused', revision: 16, items: [pending] },
    })
  })

  it('resumes a paused queue explicitly without consuming its next Follow-up', () => {
    const pending = { id: FollowUpId('follow-up-pending'), payload: 'later' }

    const result = mutateFollowUpQueue(
      { state: 'paused', revision: 21, items: [pending] },
      { type: 'resume', expectedRevision: 21 },
    )

    expect(result).toEqual({
      accepted: true,
      queue: { state: 'running', revision: 22, items: [pending] },
    })
  })
})
