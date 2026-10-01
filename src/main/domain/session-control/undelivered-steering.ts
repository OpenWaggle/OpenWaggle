import { matchBy } from '@diegogbrisa/ts-match'
import type { FollowUpId } from '@shared/types/brand'
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
 * is skipped. Queue capacity is not enforced: the user already submitted these messages.
 *
 * `bumpStateRevision: false` is for a settlement whose state transition belongs to a pending Run
 * replacement, which publishes the next state revision itself.
 */
export function returnUndeliveredSteers(
  state: SessionControlSessionState,
  steers: readonly UndeliveredSteer[],
  options: { readonly bumpStateRevision: boolean } = { bumpStateRevision: true },
): SessionControlSessionState {
  const queued = new Map(state.followUpQueue.items.map((item) => [item.id, item]))
  const front: SessionControlFollowUp[] = []
  const returnedIds = new Set<FollowUpId>()
  for (const steer of steers) {
    const item = returnedFollowUp(steer, queued)
    if (!item || returnedIds.has(item.id)) continue
    returnedIds.add(item.id)
    front.push(item)
  }
  if (front.length === 0) return state
  const rest = state.followUpQueue.items.filter((item) => !returnedIds.has(item.id))
  const items = [...front, ...rest]
  const unchanged =
    items.length === state.followUpQueue.items.length &&
    items.every((item, index) => item === state.followUpQueue.items[index])
  if (unchanged) return state
  return {
    ...state,
    revision: state.revision + (options.bumpStateRevision ? REVISION_INCREMENT : 0),
    followUpQueue: {
      ...state.followUpQueue,
      revision: state.followUpQueue.revision + REVISION_INCREMENT,
      items,
    },
  }
}
