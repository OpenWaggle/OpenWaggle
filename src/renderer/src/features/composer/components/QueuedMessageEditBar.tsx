import { Pencil } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { OpenQueuedMessageEdit } from '../state/queued-message-edit-store'

interface QueuedMessageEditBarProps {
  readonly edit: OpenQueuedMessageEdit
  readonly onCancel: () => void
}

const PHASE_COPY = {
  editing: 'Editing queued message',
  saving: 'Saving queued message…',
  cancelling: 'Cancelling edit…',
} as const satisfies Record<OpenQueuedMessageEdit['phase'], string>

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
