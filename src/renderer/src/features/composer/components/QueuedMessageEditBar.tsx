import { Pencil } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { QueuedMessageEdit } from '../state/queued-message-edit-store'

interface QueuedMessageEditBarProps {
  readonly edit: QueuedMessageEdit
  readonly onCancel: () => void
}

const PHASE_COPY = {
  beginning: 'Opening queued message…',
  editing: 'Editing queued message',
  saving: 'Saving queued message…',
  cancelling: 'Cancelling edit…',
} as const satisfies Record<QueuedMessageEdit['phase'], string>

/**
 * Edit-mode marker above the composer input. The queue waits at this message until the edit is
 * saved or cancelled, so the way out is always on screen. Escape in the input cancels too.
 */
export function QueuedMessageEditBar({ edit, onCancel }: QueuedMessageEditBarProps) {
  return (
    <div
      className="flex items-center gap-1.5 border-b border-border px-4 py-1.5"
      data-qa="queued-message-edit-bar"
    >
      <Pencil aria-hidden="true" className="size-3 shrink-0 text-accent" />
      <span role="status" className="flex-1 text-xs font-semibold text-text-secondary">
        {PHASE_COPY[edit.phase]}
      </span>
      <span className="text-xs text-text-tertiary">Enter to save · Esc to cancel</span>
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onClick={onCancel}
        disabled={edit.phase !== 'editing'}
        aria-label="Cancel editing queued message"
      >
        Cancel
      </Button>
    </div>
  )
}

/**
 * The edit belongs to another draft of this Session (another branch or message), so this one is
 * an ordinary composer. The queue still waits on the edit, so say so and offer the way out.
 */
export function QueuedMessageEditElsewhereNote({ onCancel }: { readonly onCancel: () => void }) {
  return (
    <div
      className="flex items-center gap-1.5 border-b border-border px-4 py-1.5"
      data-qa="queued-message-edit-elsewhere"
    >
      <Pencil aria-hidden="true" className="size-3 shrink-0 text-info" />
      <span role="status" className="flex-1 text-xs text-text-secondary">
        A queued message is being edited in another branch. Go back to that branch to finish it.
      </span>
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onClick={onCancel}
        aria-label="Cancel editing queued message"
      >
        Cancel edit
      </Button>
    </div>
  )
}
