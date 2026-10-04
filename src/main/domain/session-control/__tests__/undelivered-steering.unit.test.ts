import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS } from '@shared/types/session-control-returned-steers'
import { describe, expect, it } from 'vitest'
import { MAX_FOLLOW_UP_QUEUE_ITEMS, mutateFollowUpQueue } from '../follow-up-queue'
import type { SessionControlFollowUp, SessionControlSessionState } from '../message-aggregate'
import { releaseRejectedRunInterruption } from '../run-interruption'
import {
  pauseStrandedFollowUps,
  queueHasRoomForReturnableSteer,
  returnUndeliveredSteers,
  returnUndeliveredSteersReportingDrops,
} from '../undelivered-steering'

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

  it('never returns more direct steers than the queue can list, however many Runs return them', () => {
    const items = Array.from({ length: MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS - 1 }, (_, index) =>
      followUp(`queued-${index}`),
    )
    const promoted = items[5]
    if (!promoted) throw new Error('fixture')
    const { state: returned, dropped } = returnUndeliveredSteersReportingDrops(state(items), [
      { delivery: { kind: 'steer', followUp: followUp('direct-a') }, handedOff: true },
      { delivery: { kind: 'steer', followUp: followUp('direct-b') }, handedOff: true },
      { delivery: { kind: 'promoted-follow-up', followUpId: promoted.id }, handedOff: true },
    ])
    expect(dropped.map((item) => item.id)).toEqual([FollowUpId('direct-b')])
    expect(returned.followUpQueue.items).toHaveLength(MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS)
    expect(returned.followUpQueue.items.slice(0, 2).map((item) => item.id)).toEqual([
      FollowUpId('direct-a'),
      promoted.id,
    ])
  })

  it('leaves a queue waiting on an edit running when its Session has no Run', () => {
    const held: SessionControlSessionState = {
      ...state([
        {
          ...followUp('held'),
          editHold: {
            holdId: 'hold-1',
            holderCallerId: 'local-user',
            acquiredAt: 1000,
            missedSweeps: 0,
            baseQueueRevision: 3,
          },
        },
      ]),
      run: { state: 'idle' },
    }
    expect(pauseStrandedFollowUps(held)).toBe(held)
  })

  it('pauses a running queue left on a Session with no Run, so its Follow-ups are not stranded', () => {
    const stranded: SessionControlSessionState = {
      ...state([followUp('returned')]),
      run: { state: 'idle' },
    }
    const paused = pauseStrandedFollowUps(stranded)
    expect(paused.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'run-interrupted',
      revision: 4,
    })
    expect(paused.revision).toBe(8)
    expect(pauseStrandedFollowUps(state([followUp('waiting')]))).toMatchObject({
      followUpQueue: { state: 'running' },
    })
    const empty: SessionControlSessionState = { ...state([]), run: { state: 'idle' } }
    expect(pauseStrandedFollowUps(empty)).toBe(empty)
  })

  it('pauses the queue when a refused interruption releases a Run that already settled', () => {
    const released = releaseRejectedRunInterruption(
      state([followUp('returned')]),
      RunId('run-stopped'),
    )
    expect(released.run).toEqual({ state: 'idle' })
    expect(released.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'run-interrupted',
    })
  })

  it('admits a direct steer only while the queue has room to take it back', () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_, index) => followUp(`queued-${index}`))
    expect(queueHasRoomForReturnableSteer(state(items(MAX_FOLLOW_UP_QUEUE_ITEMS - 1)))).toBe(true)
    expect(queueHasRoomForReturnableSteer(state(items(MAX_FOLLOW_UP_QUEUE_ITEMS)))).toBe(false)
  })

  it('keeps a queue pushed past capacity by returned steers reorderable and withdrawable', () => {
    const items = Array.from({ length: MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS }, (_, index) =>
      followUp(`queued-${index}`),
    )
    const queue = state(items).followUpQueue
    const reordered = mutateFollowUpQueue(queue, {
      type: 'reorder',
      expectedRevision: queue.revision,
      orderedFollowUpIds: [...items].reverse().map((item) => item.id),
    })
    expect(reordered).toMatchObject({ accepted: true })
    const withdrawn = mutateFollowUpQueue(queue, {
      type: 'withdraw',
      followUpIds: [FollowUpId('queued-0')],
    })
    expect(withdrawn.accepted && withdrawn.queue.items).toHaveLength(
      MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS - 1,
    )
  })
})
