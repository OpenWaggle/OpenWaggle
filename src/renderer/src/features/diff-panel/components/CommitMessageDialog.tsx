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

/**
 * Collects an explicit commit message for a commit-bearing stacked git action
 * (review B2): a one-click action must never invent an unreviewed "Update" commit.
 * Uses a native <dialog> for focus trapping, Escape handling, and a11y.
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
    <ModalDialog labelledBy={headingId} onClose={onCancel} className="max-w-[420px] p-4">
      <h2 id={headingId} className="text-[13px] font-medium text-text-primary">
        Commit message
      </h2>
      {/*
        Names the tree, not the tab. The count used to come from whatever scope was on display, so
        a commit started from the Branch or Turn tab reported that scope's file count while
        committing the working tree's changes.
      */}
      <p className="mt-1 text-[12px] text-text-tertiary">
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
    </ModalDialog>
  )
}
