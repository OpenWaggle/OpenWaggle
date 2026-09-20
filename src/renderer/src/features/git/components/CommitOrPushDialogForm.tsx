import type { GitStackedAction } from '@shared/types/git'
import { GitBranch, GitCommit, Loader2, Upload } from 'lucide-react'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Select } from '@/shared/ui/Select'
import { Textarea } from '@/shared/ui/Textarea'
import type {
  CommitOrPushDialogController,
  CommitOrPushOperation,
} from './commit-or-push-dialog-types'

function changedFileLabel(count: number, kind: 'staged' | 'unstaged') {
  return `${String(count)} ${kind} ${count === 1 ? 'file' : 'files'}`
}

function ChangeStats(props: {
  readonly label: string
  readonly additions: number
  readonly deletions: number
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
      <span>{props.label}</span>
      <span className="ml-auto text-success">+{props.additions}</span>
      <span className="text-error">-{props.deletions}</span>
    </span>
  )
}

function CommitTargetFields(props: {
  readonly controller: CommitOrPushDialogController
  readonly running: boolean
}) {
  const { controller } = props
  return (
    <>
      <label
        htmlFor="commit-or-push-target"
        className="block text-xs font-medium text-text-secondary"
      >
        Target
        <Select
          id="commit-or-push-target"
          aria-label="Commit target"
          selectSize="md"
          className="mt-1.5 block w-full bg-bg text-text-primary"
          value={controller.target}
          aria-disabled={props.running}
          onChange={(event) => {
            if (props.running) return
            const target = event.target.value
            if (target === 'current' || target === 'new') controller.setTarget(target)
          }}
        >
          <option value="current">Current branch</option>
          <option value="new">New branch</option>
        </Select>
      </label>
      {controller.target === 'new' ? (
        <label className="block text-xs font-medium text-text-secondary">
          New branch name
          <span className="mt-1.5 flex h-9 items-center gap-2 rounded-lg border border-input-card-border bg-bg px-2.5">
            <GitBranch className="size-3.5 text-text-tertiary" />
            <input
              aria-label="New branch name"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text-primary outline-none"
              value={controller.branchName}
              readOnly={props.running}
              aria-disabled={props.running}
              onChange={(event) => {
                if (!props.running) controller.setBranchName(event.target.value)
              }}
            />
            {controller.validationChecking ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : null}
          </span>
        </label>
      ) : null}
      {controller.branchReason ? (
        <p role="alert" className="text-xs text-error-text">
          {controller.branchReason}
        </p>
      ) : null}
    </>
  )
}

function CommitInputs(props: {
  readonly controller: CommitOrPushDialogController
  readonly running: boolean
}) {
  const { controller } = props
  return (
    <>
      <label
        htmlFor="commit-or-push-message"
        className="block text-xs font-medium text-text-secondary"
      >
        Commit message <span className="text-text-tertiary">(required for commit)</span>
        <Textarea
          id="commit-or-push-message"
          autoFocus
          aria-label="Commit message"
          value={controller.message}
          readOnly={props.running}
          aria-disabled={props.running}
          onChange={(event) => {
            if (!props.running) controller.setMessage(event.target.value)
          }}
          placeholder="Describe the change"
          resize="none"
          className="mt-1.5 h-20"
        />
      </label>
      <div className="space-y-2 rounded-lg border border-border bg-bg-tertiary/40 p-2.5">
        <ChangeStats
          label={changedFileLabel(controller.stats.staged.filesChanged, 'staged')}
          additions={controller.stats.staged.additions}
          deletions={controller.stats.staged.deletions}
        />
        <Checkbox
          aria-label="Include unstaged changes"
          checked={controller.includeUnstaged}
          disabled={controller.stats.unstaged.filesChanged === 0}
          aria-disabled={props.running || controller.stats.unstaged.filesChanged === 0}
          onChange={(event) => {
            if (!props.running) controller.setIncludeUnstaged(event.target.checked)
          }}
          label={
            <ChangeStats
              label={changedFileLabel(controller.stats.unstaged.filesChanged, 'unstaged')}
              additions={controller.stats.unstaged.additions}
              deletions={controller.stats.unstaged.deletions}
            />
          }
          labelClassName="w-full"
        />
      </div>
    </>
  )
}

function GitActionStatus(props: {
  readonly operation: CommitOrPushOperation
  readonly stopRequested: boolean
}) {
  const progress = props.operation.progress
  if (!props.operation.running || !progress) {
    return (
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {''}
      </div>
    )
  }
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="space-y-1 text-xs text-text-secondary"
    >
      <p className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
        {progress.label} {String(progress.index + 1)} of {String(progress.total)}
      </p>
      <p className="text-text-tertiary">
        {props.stopRequested
          ? 'Stop requested. The current Git step will finish first.'
          : 'Stopping takes effect after the current Git step finishes.'}
      </p>
    </div>
  )
}

function actionIcon(action: GitStackedAction) {
  return action === 'push' ? Upload : GitCommit
}

function CommitCommandActions(props: {
  readonly controller: CommitOrPushDialogController
  readonly operation: CommitOrPushOperation
}) {
  const { controller, operation } = props
  return (
    <footer className="space-y-1 border-t border-border p-2">
      {controller.actions.map((entry) => {
        const Icon = actionIcon(entry.action)
        const showShortcut = controller.primary?.action === entry.action
        return (
          <div key={entry.action}>
            <Button
              variant={showShortcut ? 'subtle' : 'ghost'}
              align="between"
              fullWidth
              aria-label={entry.label}
              disabled={!entry.enabled}
              aria-disabled={!entry.enabled || operation.running}
              aria-describedby={entry.disabledReason ? `${entry.action}-reason` : undefined}
              aria-keyshortcuts={showShortcut ? 'Control+Enter Meta+Enter' : undefined}
              onClick={() => {
                if (!operation.running) void controller.run(entry.action)
              }}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="size-4" />
                {entry.label}
              </span>
              {showShortcut ? (
                <span className="rounded bg-bg px-1.5 py-0.5 text-xs text-text-tertiary">
                  {usesAppleShortcuts() ? '⌘↵' : 'Ctrl + Enter'}
                </span>
              ) : null}
            </Button>
            {entry.disabledReason ? (
              <p id={`${entry.action}-reason`} className="px-2.5 pb-1 text-xs text-text-muted">
                {entry.disabledReason}
              </p>
            ) : null}
          </div>
        )
      })}
      {operation.running ? (
        <Button
          variant="ghost"
          align="start"
          fullWidth
          aria-disabled={controller.stopRequested}
          onClick={() => {
            if (!controller.stopRequested) void controller.stop()
          }}
        >
          {controller.stopRequested ? 'Stop requested' : 'Stop after current step'}
        </Button>
      ) : null}
    </footer>
  )
}

export function CommitOrPushDialogForm(props: {
  readonly controller: CommitOrPushDialogController
  readonly operation: CommitOrPushOperation
}) {
  return (
    <form
      aria-busy={props.operation.running}
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={props.controller.onKeyDown}
    >
      <div className="space-y-3 p-4">
        <CommitTargetFields controller={props.controller} running={props.operation.running} />
        <CommitInputs controller={props.controller} running={props.operation.running} />
        {props.controller.error ? (
          <p role="alert" className="text-xs text-error-text">
            {props.controller.error}
          </p>
        ) : null}
        <GitActionStatus
          operation={props.operation}
          stopRequested={props.controller.stopRequested}
        />
      </div>
      <CommitCommandActions controller={props.controller} operation={props.operation} />
    </form>
  )
}
