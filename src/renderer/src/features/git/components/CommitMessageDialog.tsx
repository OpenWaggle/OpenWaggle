import { useId, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Textarea } from '@/shared/ui/Textarea'

interface CommitMessageDialogProps {
  readonly open: boolean
  readonly fileCount: number
  readonly onCancel: () => void
  readonly onConfirm: (message: string) => void
}

/** Collects the explicit message required by commit-bearing stacked actions. */
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
    <ModalDialog labelledBy={headingId} onClose={onCancel} className="max-w-105 p-4">
      <h2 id={headingId} className="text-sm font-medium text-text-primary">
        Commit message
      </h2>
      <p className="mt-1 text-xs text-text-tertiary">
        {fileCount === 1
          ? '1 changed file in the working tree will be committed.'
          : `${String(fileCount)} changed files in the working tree will be committed.`}
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
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="button"
          disabled={trimmed.length === 0}
          onClick={() => onConfirm(trimmed)}
        >
          Continue
        </Button>
      </div>
    </ModalDialog>
  )
}
