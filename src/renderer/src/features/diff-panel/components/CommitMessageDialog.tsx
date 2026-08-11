import { useId, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'

interface CommitMessageDialogProps {
  readonly open: boolean
  readonly fileCount: number
  readonly onCancel: () => void
  readonly onConfirm: (message: string) => void
}

/**
 * Collects an explicit commit message for a commit-bearing stacked git action
 * (review B2): a one-click action must never invent an unreviewed "Update" commit.
 */
export function CommitMessageDialog({
  open,
  fileCount,
  onCancel,
  onConfirm,
}: CommitMessageDialogProps) {
  const headingId = useId()
  const [message, setMessage] = useState('')
  if (!open) return null
  const trimmed = message.trim()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-[420px] rounded-lg border border-border bg-bg-secondary p-4">
        <h2 id={headingId} className="text-[13px] font-medium text-text-primary">
          Commit message
        </h2>
        <p className="mt-1 text-[12px] text-text-tertiary">
          {fileCount === 1
            ? '1 file will be committed.'
            : `${String(fileCount)} files will be committed.`}
        </p>
        <Textarea
          autoFocus
          aria-label="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Describe the change"
          className="mt-3 h-24 w-full"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="unstyled"
            type="button"
            onClick={onCancel}
            className="h-8 rounded-lg px-3 text-[13px] text-text-tertiary hover:text-text-secondary"
          >
            Cancel
          </Button>
          <Button
            variant="unstyled"
            type="button"
            disabled={trimmed.length === 0}
            onClick={() => onConfirm(trimmed)}
            className="h-8 rounded-lg bg-accent px-3 text-[13px] text-white disabled:opacity-50"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}
