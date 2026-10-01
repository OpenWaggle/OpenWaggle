import { Pencil } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { ComposerQueuedEditMode } from '../hooks/useComposerQueuedEditMode'
import type { QueuedMessageEdit } from '../state/queued-message-edit-store'

interface QueuedMessageEditBarProps {
  readonly edit: QueuedMessageEdit
  /** A first Escape on a changed edit: say that a second one discards the changes. */
  readonly escapeArmed: boolean
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
export function QueuedMessageEditBar({ edit, escapeArmed, onCancel }: QueuedMessageEditBarProps) {
  const busy = edit.phase !== 'editing'
  return (
    <div
      className="flex items-center gap-1.5 border-b border-border px-4 py-1.5"
      data-qa="queued-message-edit-bar"
    >
      <Pencil aria-hidden="true" className="size-3 shrink-0 text-accent" />
      <span role="status" className="flex-1 text-xs font-semibold text-text-secondary">
        {PHASE_COPY[edit.phase]}
      </span>
      <span aria-live="polite" className="text-xs text-text-tertiary">
        {escapeArmed ? 'Press Esc again to discard your changes' : 'Enter to save · Esc to cancel'}
      </span>
      {/* aria-disabled, not disabled: focus stays on the button while the Host answers. */}
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onClick={() => {
          if (!busy) onCancel()
        }}
        aria-disabled={busy}
        aria-label="Cancel editing queued message"
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
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

/** Whichever edit notice the composer needs: edit mode here, or an edit in another branch. */
export function QueuedMessageEditNotices({ mode }: { readonly mode: ComposerQueuedEditMode }) {
  if (mode.here) {
    return (
      <QueuedMessageEditBar
        edit={mode.here}
        escapeArmed={mode.escapeArmed}
        onCancel={mode.cancel}
      />
    )
  }
  return mode.elsewhere ? <QueuedMessageEditElsewhereNote onCancel={mode.cancel} /> : null
}
