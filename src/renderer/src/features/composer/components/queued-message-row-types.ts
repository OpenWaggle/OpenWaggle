import type { QueuedMessageAnchor } from '../lib/queued-message-order'
import type { QueuedMessageEdit } from '../state/queued-message-edit-store'

export interface QueuedMessageRowActions {
  readonly onDismiss: (followUpId: string) => void
  readonly onSteer: (followUpId: string) => void
  readonly onEdit: (followUpId: string) => void
  readonly onMove: (followUpId: string, anchor: QueuedMessageAnchor) => void
  /** Drag bookkeeping lives outside React state: re-rendering mid-gesture cancels the drag. */
  readonly onDragStart: (followUpId: string) => void
  readonly onDragEnd: () => void
  /** Where the dragged message would land relative to `followUpId`, or null for no drop. */
  readonly dropAnchor: (followUpId: string) => QueuedMessageAnchor | null
  /** Drops the dragged message onto `followUpId`'s row. */
  readonly onDropOn: (followUpId: string) => void
}

export interface QueuedMessageRowEditState {
  /** No other edit is open or starting in this Session, and the composer is not mid-work. */
  readonly canBegin: boolean
  /** This window's edit of this row, when there is one. */
  readonly phase: QueuedMessageEdit['phase'] | null
}
