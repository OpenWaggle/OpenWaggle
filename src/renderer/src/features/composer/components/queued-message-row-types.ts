import type { DragEvent } from 'react'
import type { QueuedMessageAnchor } from '../lib/queued-message-order'
import type { QueuedMessageEdit } from '../state/queued-message-edit-store'

export interface QueuedMessageRowActions {
  readonly onDismiss: (followUpId: string) => void
  readonly onSteer: (followUpId: string) => void
  /** Sends a needs-attention Follow-up as the desktop user, under the user's own access. */
  readonly onAdopt: (followUpId: string) => void
  readonly onEdit: (followUpId: string) => void
  readonly onMove: (followUpId: string, anchor: QueuedMessageAnchor) => void
  /**
   * Starts dragging `followUpId` from its grip: the whole row becomes the drag image and stays in
   * place as a placeholder. Drag bookkeeping lives outside React state: re-rendering mid-gesture
   * cancels the drag. The list, not the row, handles where the message is dropped.
   */
  readonly onDragStart: (followUpId: string, event: DragEvent<HTMLElement>) => void
  readonly onDragEnd: () => void
}

export interface QueuedMessageRowEditState {
  /** No other edit is open or starting in this Session, and the composer is not mid-work. */
  readonly canBegin: boolean
  /** This window's edit of this row, when there is one. */
  readonly phase: QueuedMessageEdit['phase'] | null
}
