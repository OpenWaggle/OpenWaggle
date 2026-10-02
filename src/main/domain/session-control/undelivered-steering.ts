import { matchBy } from '@diegogbrisa/ts-match'
import type { FollowUpId } from '@shared/types/brand'
import { MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS } from '@shared/types/session-control-returned-steers'
import { isFollowUpEditHeld } from './follow-up-delivery'
import { MAX_FOLLOW_UP_QUEUE_ITEMS, mutateFollowUpQueue } from './follow-up-queue'
import type { SessionControlFollowUp, SessionControlSessionState } from './message-aggregate'

const REVISION_INCREMENT = 1

/**
 * Where a Steering message came from, so a Run that ends before incorporating it can hand it back
 * as a Follow-up message.
 *
 * - `promoted-follow-up`: a Steering promotion. Its Follow-up stays in the queue until Pi
 *   incorporates the steer, so returning it moves that same item, with its identity and intent.
 * - `steer`: a direct Steering message. It never was a Follow-up; `followUp` is the Follow-up it
 *   becomes, carrying the submitted intent and its caller.
 */
export type SteeringDelivery =
  | { readonly kind: 'promoted-follow-up'; readonly followUpId: FollowUpId }
  | { readonly kind: 'steer'; readonly followUp: SessionControlFollowUp }

/**
 * A Steering message its Run ended without incorporating. `handedOff` is whether the Run had
 * accepted it from Session Control (Pi queued it) before ending; a steer still waiting for
 * compaction was not.
 */
export interface UndeliveredSteer {
  readonly delivery: SteeringDelivery
  readonly handedOff: boolean
}

function returnedFollowUp(
  steer: UndeliveredSteer,
  queued: ReadonlyMap<FollowUpId, SessionControlFollowUp>,
): SessionControlFollowUp | undefined {
  return matchBy(steer.delivery, 'kind')
    .with('promoted-follow-up', (delivery) => queued.get(delivery.followUpId))
    .with('steer', (delivery) =>
      // A direct steer that never reached Pi was refused to its caller, who still holds it. One
      // already in the queue was returned before (settlement retried); never add it twice.
      steer.handedOff && !queued.has(delivery.followUp.id) ? delivery.followUp : undefined,
    )
    .exhaustive()
}

/**
 * Return a stopped Run's Undelivered steering messages to the front of the Follow-up queue, in
 * the order they were steered and ahead of every waiting Follow-up. A promoted Follow-up keeps its
 * identity and whole item; one no longer queued (withdrawn, or removed by an accepted promotion)
 * is skipped. Queue capacity is not enforced: the user already submitted these messages. Direct
 * steers are admitted only while the queue has room and are bounded per Run; past
 * `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS` (only reachable when several displaced Runs return their
 * steers together) the excess direct steers are dropped, so every queued id stays nameable; use
 * `returnUndeliveredSteersReportingDrops` to report them.
 */
export function returnUndeliveredSteers(
  state: SessionControlSessionState,
  steers: readonly UndeliveredSteer[],
): SessionControlSessionState {
  return returnUndeliveredSteersReportingDrops(state, steers).state
}

/**
 * `returnUndeliveredSteers`, also naming the direct steers it dropped past the listed cap. Their
 * callers already hold a steered-Run receipt, so the caller must report the drop.
 */
export function returnUndeliveredSteersReportingDrops(
  state: SessionControlSessionState,
  steers: readonly UndeliveredSteer[],
): {
  readonly state: SessionControlSessionState
  readonly dropped: readonly SessionControlFollowUp[]
} {
  const queued = new Map(state.followUpQueue.items.map((item) => [item.id, item]))
  const front: SessionControlFollowUp[] = []
  const dropped: SessionControlFollowUp[] = []
  const returnedIds = new Set<FollowUpId>()
  // Direct steers add items; promoted ones only move. Admission bounds one Run's direct steers,
  // but steers of displaced Runs can return together, so the total is clamped here: a queue
  // never lists more than `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS`, which a reorder can always name.
  let room = MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS - state.followUpQueue.items.length
  for (const steer of steers) {
    const item = returnedFollowUp(steer, queued)
    if (!item || returnedIds.has(item.id)) continue
    const adds = !queued.has(item.id)
    if (adds && room <= 0) {
      dropped.push(item)
      continue
    }
    if (adds) room -= 1
    returnedIds.add(item.id)
    front.push(item)
  }
  return { state: withFront(state, front, returnedIds), dropped }
}

function withFront(
  state: SessionControlSessionState,
  front: readonly SessionControlFollowUp[],
  returnedIds: ReadonlySet<FollowUpId>,
): SessionControlSessionState {
  if (front.length === 0) return state
  const rest = state.followUpQueue.items.filter((item) => !returnedIds.has(item.id))
  const items = [...front, ...rest]
  const unchanged =
    items.length === state.followUpQueue.items.length &&
    items.every((item, index) => item === state.followUpQueue.items[index])
  if (unchanged) return state
  return {
    ...state,
    revision: state.revision + REVISION_INCREMENT,
    followUpQueue: {
      ...state.followUpQueue,
      revision: state.followUpQueue.revision + REVISION_INCREMENT,
      items,
    },
  }
}

/**
 * Pause a running queue that waits on a Session with no Run. Nothing schedules a queue between
 * Runs, so Follow-ups left behind by a Run that ended outside its own settlement (a refused
 * interruption, or a settlement another writer overtook) would wait forever. Paused, they show why
 * and the user can resume, steer, or dismiss them.
 */
export function pauseStrandedFollowUps(
  state: SessionControlSessionState,
): SessionControlSessionState {
  if (
    state.run.state !== 'idle' ||
    state.followUpQueue.state !== 'running' ||
    state.followUpQueue.items.length === 0 ||
    // Not stranded: the queue waits on an open edit, and releasing it delivers (ADR 0044).
    isFollowUpEditHeld(state.followUpQueue.items[0])
  ) {
    return state
  }
  const paused = mutateFollowUpQueue(state.followUpQueue, {
    type: 'pause',
    expectedRevision: state.followUpQueue.revision,
    reason: 'run-interrupted',
  })
  if (!paused.accepted) return state
  return { ...state, revision: state.revision + REVISION_INCREMENT, followUpQueue: paused.queue }
}

/**
 * A direct steer is admitted only while the Follow-up queue has room for it, because a Run that
 * stops before incorporating it returns it there. With the Pi runtime bounding the direct steers
 * one Run can hand back, a queue never grows past `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS`.
 */
export function queueHasRoomForReturnableSteer(state: SessionControlSessionState) {
  return state.followUpQueue.items.length < MAX_FOLLOW_UP_QUEUE_ITEMS
}
