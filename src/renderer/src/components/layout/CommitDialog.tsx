import type { GitCommitResult, GitStatusSummary } from '@shared/types/git'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

interface CommitDialogProps {
  isOpen: boolean
  projectPath: string | null
  status: GitStatusSummary | null
  statusError: string | null
  isRefreshing: boolean
  isCommitting: boolean
  onRefresh: () => void
  onCommit: (message: string, amend: boolean, paths: string[]) => Promise<GitCommitResult>
  onClose: () => void
}

const STATUS_CLASS: Record<string, string> = {
  modified: 'text-text-secondary',
  added: 'text-success',
  deleted: 'text-error',
  renamed: 'text-accent',
  copied: 'text-accent',
  untracked: 'text-text-tertiary',
  unknown: 'text-text-tertiary',
}

function humanCommitError(result: GitCommitResult): string {
  if (result.ok) return ''

  switch (result.code) {
    case 'empty-message':
      return 'Commit message is required.'
    case 'nothing-to-commit':
      return 'No changes are available to commit.'
    case 'merge-in-progress':
      return 'A merge is in progress. Resolve it before committing.'
    case 'not-git-repo':
      return 'Selected folder is not a Git repository.'
    default:
      return result.message
  }
}

export function CommitDialog({
  isOpen,
  projectPath,
  status,
  statusError,
  isRefreshing,
  isCommitting,
  onRefresh,
  onCommit,
  onClose,
}: CommitDialogProps): React.JSX.Element | null {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const changedFiles = status?.changedFiles ?? []

  // Reset state when dialog opens/closes; sync selected paths with status
  useEffect(() => {
    if (isOpen && status) {
      setSelectedPaths(new Set(status.changedFiles.map((f) => f.path)))
    }
    if (!isOpen) {
      setMessage('')
      setAmend(false)
      setError(null)
      setSelectedPaths(new Set())
    }
  }, [isOpen, status])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  function togglePath(filePath: string): void {
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

  function toggleAll(): void {
    if (selectedPaths.size === changedFiles.length) {
      setSelectedPaths(new Set())
    } else {
      setSelectedPaths(new Set(changedFiles.map((f) => f.path)))
    }
  }

  async function handleCommit(): Promise<void> {
    if (!projectPath || !message.trim() || selectedPaths.size === 0) return
    setError(null)
    const result = await onCommit(message.trim(), amend, [...selectedPaths])
    if (result.ok) {
      onClose()
      return
    }
    setError(humanCommitError(result))
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
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2">
            <div className="text-xs text-text-secondary">
              {status
                ? `${selectedPaths.size}/${status.filesChanged} files selected • +${status.additions} / -${status.deletions}`
                : 'Git status unavailable'}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-1 text-xs text-text-tertiary transition-colors hover:text-text-secondary"
              title="Refresh status"
              disabled={isRefreshing}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>

          {statusError && <p className="text-xs text-error">{statusError}</p>}
          {error && <p className="text-xs text-error">{error}</p>}

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">
              Commit message
            </span>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your changes"
              className="w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={amend}
              onChange={(e) => setAmend(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border bg-bg"
            />
            Amend last commit
          </label>

          <div className="max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg">
            {changedFiles.length > 0 && (
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={selectedPaths.size === changedFiles.length}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-border bg-bg"
                />
                <span className="text-[11px] font-medium text-text-tertiary">
                  {selectedPaths.size === changedFiles.length ? 'Deselect all' : 'Select all'}
                </span>
              </div>
            )}
            {changedFiles.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-tertiary">No file changes detected.</div>
            ) : (
              changedFiles.map((file) => (
                <label
                  key={file.path}
                  className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0 cursor-pointer hover:bg-bg-hover transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(file.path)}
                    onChange={() => togglePath(file.path)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-border bg-bg"
                  />
                  <span className={cn('truncate text-xs flex-1', STATUS_CLASS[file.status])}>
                    {file.path}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-tertiary">
                    {file.additions > 0 ? `+${file.additions}` : ''}
                    {file.additions > 0 && file.deletions > 0 ? ' / ' : ''}
                    {file.deletions > 0 ? `-${file.deletions}` : ''}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCommit()}
            disabled={!canSubmit}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              canSubmit
                ? 'bg-gradient-to-b from-accent to-accent-dim text-bg'
                : 'cursor-not-allowed border border-border bg-bg-tertiary text-text-tertiary',
            )}
          >
            {isCommitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Commit
          </button>
        </div>
      </div>
    </div>
  )
}
