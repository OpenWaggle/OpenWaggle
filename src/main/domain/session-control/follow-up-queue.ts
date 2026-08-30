import { matchBy } from '@diegogbrisa/ts-match'
import type { FollowUpId } from '@shared/types/brand'

const REVISION_INCREMENT = 1

export interface FollowUpQueueItem {
  readonly id: FollowUpId
}

export interface FollowUpQueue<TItem extends FollowUpQueueItem> {
  readonly state: 'running' | 'paused'
  readonly revision: number
  readonly items: readonly TItem[]
}

export interface AppendFollowUp<TItem extends FollowUpQueueItem> {
  readonly type: 'append'
  readonly item: TItem
}

export interface WithdrawFollowUp {
  readonly type: 'withdraw'
  readonly followUpIds: readonly FollowUpId[]
}

export interface ReorderFollowUps {
  readonly type: 'reorder'
  readonly expectedRevision: number
  readonly orderedFollowUpIds: readonly FollowUpId[]
}

export interface PauseFollowUpQueue {
  readonly type: 'pause'
  readonly expectedRevision: number
}

export interface ResumeFollowUpQueue {
  readonly type: 'resume'
  readonly expectedRevision: number
}

export type FollowUpQueueMutation<TItem extends FollowUpQueueItem> =
  | AppendFollowUp<TItem>
  | WithdrawFollowUp
  | ReorderFollowUps
  | PauseFollowUpQueue
  | ResumeFollowUpQueue

export type FollowUpQueueMutationResult<TItem extends FollowUpQueueItem> =
  | { readonly accepted: true; readonly queue: FollowUpQueue<TItem> }
  | FollowUpQueueMutationRejection

interface FollowUpQueueMutationRejection {
  readonly accepted: false
  readonly code:
    | 'queue_revision_changed'
    | 'follow_up_already_exists'
    | 'follow_up_not_found'
    | 'queue_order_mismatch'
    | 'queue_already_paused'
    | 'queue_already_running'
  readonly currentRevision: number
}

function acceptedQueue<TItem extends FollowUpQueueItem>(
  queue: FollowUpQueue<TItem>,
  items: readonly TItem[],
): FollowUpQueueMutationResult<TItem> {
  return {
    accepted: true,
    queue: {
      ...queue,
      revision: queue.revision + REVISION_INCREMENT,
      items,
    },
  }
}

function revisionRejection(
  queueRevision: number,
  expectedRevision: number,
): FollowUpQueueMutationRejection | null {
  return expectedRevision === queueRevision
    ? null
    : {
        accepted: false,
        code: 'queue_revision_changed',
        currentRevision: queueRevision,
      }
}

export function mutateFollowUpQueue<TItem extends FollowUpQueueItem>(
  queue: FollowUpQueue<TItem>,
  mutation: FollowUpQueueMutation<TItem>,
): FollowUpQueueMutationResult<TItem> {
  return matchBy(mutation, 'type')
    .with('append', (append) => {
      if (queue.items.some((item) => item.id === append.item.id)) {
        return {
          accepted: false,
          code: 'follow_up_already_exists',
          currentRevision: queue.revision,
        }
      }
      return acceptedQueue(queue, [...queue.items, append.item])
    })
    .with('withdraw', (withdraw) => {
      const selectedIds = new Set(withdraw.followUpIds)
      if (
        selectedIds.size === 0 ||
        [...selectedIds].some((followUpId) => !queue.items.some((item) => item.id === followUpId))
      ) {
        return {
          accepted: false,
          code: 'follow_up_not_found',
          currentRevision: queue.revision,
        }
      }
      return acceptedQueue(
        queue,
        queue.items.filter((item) => !selectedIds.has(item.id)),
      )
    })
    .with('reorder', (reorder) => {
      const staleRevision = revisionRejection(queue.revision, reorder.expectedRevision)
      if (staleRevision) return staleRevision
      const orderedIds = new Set(reorder.orderedFollowUpIds)
      const orderMatchesQueue =
        reorder.orderedFollowUpIds.length === queue.items.length &&
        orderedIds.size === queue.items.length &&
        queue.items.every((item) => orderedIds.has(item.id))
      if (!orderMatchesQueue) {
        return {
          accepted: false,
          code: 'queue_order_mismatch',
          currentRevision: queue.revision,
        }
      }
      const itemsById = new Map(queue.items.map((item) => [item.id, item]))
      const reorderedItems = reorder.orderedFollowUpIds.flatMap((followUpId) => {
        const item = itemsById.get(followUpId)
        return item ? [item] : []
      })
      return acceptedQueue(queue, reorderedItems)
    })
    .with('pause', (pause) => {
      const staleRevision = revisionRejection(queue.revision, pause.expectedRevision)
      if (staleRevision) return staleRevision
      if (queue.state === 'paused') {
        return {
          accepted: false,
          code: 'queue_already_paused',
          currentRevision: queue.revision,
        }
      }
      return {
        accepted: true,
        queue: {
          ...queue,
          state: 'paused',
          revision: queue.revision + REVISION_INCREMENT,
        },
      }
    })
    .with('resume', (resume) => {
      const staleRevision = revisionRejection(queue.revision, resume.expectedRevision)
      if (staleRevision) return staleRevision
      if (queue.state === 'running') {
        return {
          accepted: false,
          code: 'queue_already_running',
          currentRevision: queue.revision,
        }
      }
      return {
        accepted: true,
        queue: {
          ...queue,
          state: 'running',
          revision: queue.revision + REVISION_INCREMENT,
        },
      }
    })
    .exhaustive()
}
