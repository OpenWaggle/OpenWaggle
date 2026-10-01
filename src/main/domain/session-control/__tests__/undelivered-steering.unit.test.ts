import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { SessionControlFollowUp, SessionControlSessionState } from '../message-aggregate'
import { returnUndeliveredSteers } from '../undelivered-steering'

function followUp(id: string, text = `Text ${id}`): SessionControlFollowUp {
  return {
    id: FollowUpId(id),
    deliveryState: 'pending',
    intent: {
      text,
      attachmentIds: [],
      callerId: 'local-user',
      acceptedAt: 1000,
      idempotencyKey: `key-${id}`,
    },
  }
}

function state(items: readonly SessionControlFollowUp[]): SessionControlSessionState {
  return {
    sessionId: SessionId('session-target'),
    revision: 7,
    run: { state: 'stopping', runId: RunId('run-stopped') },
    followUpQueue: { state: 'running', revision: 3, items },
  }
}

describe('returning Undelivered steering messages', () => {
  it('moves promoted Follow-ups and direct steers to the front in steering order', () => {
    const promotedLater = followUp('promoted-later')
    const promotedFirst = followUp('promoted-first')
    const waiting = followUp('waiting')
    const direct = followUp('direct-steer', 'Steered directly.')
    const returned = returnUndeliveredSteers(state([waiting, promotedLater, promotedFirst]), [
      {
        delivery: { kind: 'promoted-follow-up', followUpId: promotedFirst.id },
        handedOff: true,
      },
      { delivery: { kind: 'steer', followUp: direct }, handedOff: true },
      {
        delivery: { kind: 'promoted-follow-up', followUpId: promotedLater.id },
        handedOff: false,
      },
    ])

    expect(returned.followUpQueue.items).toEqual([promotedFirst, direct, promotedLater, waiting])
    expect(returned.followUpQueue.items[0]).toBe(promotedFirst)
    expect(returned.revision).toBe(8)
    expect(returned.followUpQueue.revision).toBe(4)
  })

  it('does not return a direct steer that never reached Pi or is already queued', () => {
    const queuedDirect = followUp('direct-returned')
    const initial = state([queuedDirect, followUp('waiting')])
    expect(
      returnUndeliveredSteers(initial, [
        { delivery: { kind: 'steer', followUp: followUp('direct-refused') }, handedOff: false },
        { delivery: { kind: 'steer', followUp: queuedDirect }, handedOff: true },
      ]),
    ).toBe(initial)
  })

  it('skips a promoted Follow-up that is no longer queued', () => {
    const initial = state([followUp('waiting')])
    expect(
      returnUndeliveredSteers(initial, [
        {
          delivery: { kind: 'promoted-follow-up', followUpId: FollowUpId('withdrawn') },
          handedOff: true,
        },
      ]),
    ).toBe(initial)
  })

  it('ignores queue capacity because the messages were already submitted', () => {
    const items = Array.from({ length: 64 }, (_, index) => followUp(`queued-${index}`))
    const returned = returnUndeliveredSteers(state(items), [
      { delivery: { kind: 'steer', followUp: followUp('direct') }, handedOff: true },
    ])
    expect(returned.followUpQueue.items).toHaveLength(65)
    expect(returned.followUpQueue.items[0]?.id).toBe(FollowUpId('direct'))
  })

  it('can leave the state revision to a pending Run replacement', () => {
    const returned = returnUndeliveredSteers(
      state([followUp('waiting')]),
      [{ delivery: { kind: 'steer', followUp: followUp('direct') }, handedOff: true }],
      { bumpStateRevision: false },
    )
    expect(returned.revision).toBe(7)
    expect(returned.followUpQueue.revision).toBe(4)
  })
})
