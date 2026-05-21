import type { GitStatusSummary } from '@shared/types/git'
import { Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Textarea } from '@/shared/ui/Textarea'

const ROWS = 3
const COMMIT_MESSAGE_ID = 'commit-message'

const STATUS_CLASS: Record<string, string> = {
  modified: 'text-text-secondary',
  added: 'text-success',
  deleted: 'text-error',
  renamed: 'text-accent',
  copied: 'text-accent',
  untracked: 'text-text-tertiary',
  unknown: 'text-text-tertiary',
}

interface CommitDialogBodyProps {
  readonly status: GitStatusSummary | null
  readonly statusError: string | null
  readonly error: string | null
  readonly isRefreshing: boolean
  readonly form: {
    readonly message: string
    readonly amend: boolean
    readonly selectedPaths: ReadonlySet<string>
  }
  readonly actions: {
    readonly onRefresh: () => void
    readonly onMessageChange: (message: string) => void
    readonly onAmendChange: (amend: boolean) => void
    readonly onTogglePath: (filePath: string) => void
    readonly onToggleAll: () => void
  }
}

export function CommitDialogBody({
  status,
  statusError,
  error,
  isRefreshing,
  form,
  actions,
}: CommitDialogBodyProps) {
  const changedFiles = status?.changedFiles ?? []
  return (
    <div className="space-y-4 p-4">
      <CommitStatusSummary
        status={status}
        selectedCount={form.selectedPaths.size}
        isRefreshing={isRefreshing}
        onRefresh={actions.onRefresh}
      />
      {statusError && <p className="text-[13px] text-error">{statusError}</p>}
      {error && <p className="text-[13px] text-error">{error}</p>}
      <CommitMessageFields form={form} actions={actions} />
      <ChangedFilesSelector
        changedFiles={changedFiles}
        selectedPaths={form.selectedPaths}
        onToggleAll={actions.onToggleAll}
        onTogglePath={actions.onTogglePath}
      />
    </div>
  )
}

function CommitStatusSummary({
  status,
  selectedCount,
  isRefreshing,
  onRefresh,
}: {
  readonly status: GitStatusSummary | null
  readonly selectedCount: number
  readonly isRefreshing: boolean
  readonly onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2">
      <div className="text-[13px] text-text-secondary">
        {status
          ? `${selectedCount}/${status.filesChanged} files selected • +${status.additions} / -${status.deletions}`
          : 'Git status unavailable'}
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={onRefresh}
        title="Refresh status"
        disabled={isRefreshing}
      >
        <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
        Refresh
      </Button>
    </div>
  )
}

function CommitMessageFields({
  form,
  actions,
}: {
  readonly form: { readonly message: string; readonly amend: boolean }
  readonly actions: {
    readonly onMessageChange: (message: string) => void
    readonly onAmendChange: (amend: boolean) => void
  }
}) {
  return (
    <>
      <label className="block" htmlFor={COMMIT_MESSAGE_ID}>
        <span className="mb-1.5 block text-[13px] font-medium text-text-secondary">
          Commit message
        </span>
        <Textarea
          id={COMMIT_MESSAGE_ID}
          rows={ROWS}
          value={form.message}
          onChange={(e) => actions.onMessageChange(e.target.value)}
          placeholder="Describe your changes"
          resize="none"
          className="rounded-md border-border text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50"
        />
      </label>
      <Checkbox
        checked={form.amend}
        onChange={(e) => actions.onAmendChange(e.target.checked)}
        label="Amend last commit"
      />
    </>
  )
}

function ChangedFilesSelector({
  changedFiles,
  selectedPaths,
  onToggleAll,
  onTogglePath,
}: {
  readonly changedFiles: NonNullable<GitStatusSummary['changedFiles']>
  readonly selectedPaths: ReadonlySet<string>
  readonly onToggleAll: () => void
  readonly onTogglePath: (filePath: string) => void
}) {
  return (
    <div className="max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg">
      {changedFiles.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <Checkbox checked={selectedPaths.size === changedFiles.length} onChange={onToggleAll} />
          <span className="text-[12px] font-medium text-text-tertiary">
            {selectedPaths.size === changedFiles.length ? 'Deselect all' : 'Select all'}
          </span>
        </div>
      )}
      {changedFiles.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-text-tertiary">No file changes detected.</div>
      ) : (
        changedFiles.map((file) => (
          <Checkbox
            key={file.path}
            checked={selectedPaths.has(file.path)}
            onChange={() => onTogglePath(file.path)}
            label={
              <>
                <span className={cn('truncate text-[13px] flex-1', STATUS_CLASS[file.status])}>
                  {file.path}
                </span>
                <span className="shrink-0 text-[12px] text-text-tertiary">
                  {file.additions > 0 ? `+${file.additions}` : ''}
                  {file.additions > 0 && file.deletions > 0 ? ' / ' : ''}
                  {file.deletions > 0 ? `-${file.deletions}` : ''}
                </span>
              </>
            }
            labelClassName="border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-bg-hover transition-colors"
          />
        ))
      )}
    </div>
  )
}

interface CommitDialogFooterProps {
  readonly canSubmit: boolean
  readonly isCommitting: boolean
  readonly onClose: () => void
  readonly onCommit: () => void
}

export function CommitDialogFooter({
  canSubmit,
  isCommitting,
  onClose,
  onCommit,
}: CommitDialogFooterProps) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant={canSubmit ? 'primary' : 'secondary'}
        onClick={onCommit}
        disabled={!canSubmit}
      >
        {isCommitting && <Loader2 className="size-3.5 animate-spin" />}
        Commit
      </Button>
    </div>
  )
}
