import { match } from '@diegogbrisa/ts-match'
import type { GitCommitResult, GitStatusSummary } from '@shared/types/git'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { Button } from '@/shared/ui/Button'
import { CommitDialogBody, CommitDialogFooter } from './CommitDialogContent'

interface CommitDialogProps {
  projectPath: string | null
  status: GitStatusSummary | null
  statusError: string | null
  isRefreshing: boolean
  isCommitting: boolean
  onRefresh: () => void
  onCommit: (message: string, amend: boolean, paths: string[]) => Promise<GitCommitResult>
  onClose: () => void
}

function humanCommitError(result: GitCommitResult) {
  if (result.ok) return ''

  return match(result.code)
    .with('empty-message', () => 'Commit message is required.')
    .with('nothing-to-commit', () => 'No changes are available to commit.')
    .with('merge-in-progress', () => 'A merge is in progress. Resolve it before committing.')
    .with('not-git-repo', () => 'Selected folder is not a Git repository.')
    .otherwise(() => result.message)
}

export function CommitDialog({
  projectPath,
  status,
  statusError,
  isRefreshing,
  isCommitting,
  onRefresh,
  onCommit,
  onClose,
}: CommitDialogProps) {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set((status?.changedFiles ?? []).map((file) => file.path)),
  )
  const changedFiles = status?.changedFiles ?? []

  useEscapeHotkey(onClose)

  function togglePath(filePath: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }

  function toggleAll() {
    setSelectedPaths(
      selectedPaths.size === changedFiles.length
        ? new Set()
        : new Set(changedFiles.map((file) => file.path)),
    )
  }

  async function handleCommit() {
    if (!projectPath || !message.trim() || selectedPaths.size === 0) return
    setError(null)
    await match
      .promise(onCommit(message.trim(), amend, [...selectedPaths]))
      .with({ ok: true }, () => onClose())
      .with({ ok: false }, (result) => setError(humanCommitError(result)))
      .exhaustive()
  }

  const canSubmit = !!projectPath && !!message.trim() && selectedPaths.size > 0 && !isCommitting

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Commit changes"
    >
      <div className="w-full max-w-[620px] rounded-xl border border-border-light bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Commit changes</h2>
          <Button
            variant="unstyled"
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Close"
          >
            <X className="size-4" />
          </Button>
        </div>

        <CommitDialogBody
          status={status}
          statusError={statusError}
          error={error}
          isRefreshing={isRefreshing}
          form={{ message, amend, selectedPaths }}
          actions={{
            onRefresh,
            onMessageChange: setMessage,
            onAmendChange: setAmend,
            onTogglePath: togglePath,
            onToggleAll: toggleAll,
          }}
        />
        <CommitDialogFooter
          canSubmit={canSubmit}
          isCommitting={isCommitting}
          onClose={onClose}
          onCommit={() => void handleCommit()}
        />
      </div>
    </div>
  )
}
