import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useWorkspacePreparation } from '../hooks/useWorkspacePreparation'
import { PreparationReviewDialog } from './PreparationReviewDialog'

function cleanupAlertMessage(preparation: WorkspacePreparation, generationMismatch: boolean) {
  if (generationMismatch)
    return 'This checkout no longer matches the one that captured its cleanup. Cleanup cannot run here; choose Delete anyway to remove this checkout.'
  if (preparation.cleanup.status === 'succeeded' || preparation.cleanup.status === 'skipped')
    return 'Cleanup completed, but the worktree remains. Review changes or locks, then retry removal or explicitly force it.'
  return (
    preparation.cleanup.error ?? 'Workspace cleanup needs attention. The worktree was retained.'
  )
}

export function WorkspaceCleanupFailure(props: {
  readonly projectPath: string
  readonly initial: WorkspacePreparation
  readonly generationMismatch?: boolean
  readonly busy: boolean
  readonly onRetry: () => void
  readonly onDeleteAnyway: () => void
  readonly onForceRemove: () => void
}) {
  const [closedReview, setClosedReview] = useState(false)
  const state = useWorkspacePreparation({
    projectPath: props.projectPath,
    workspaceId: props.initial.workspaceId,
  })
  const preparation = state.data ?? props.initial
  const cleanupCompleted =
    preparation.cleanup.status === 'succeeded' || preparation.cleanup.status === 'skipped'
  const required = props.generationMismatch
    ? undefined
    : preparation.snapshot.definitions.find(
        (entry) => entry.definition.phase === 'cleanup' && entry.review === 'required',
      )
  const busy = props.busy || state.mutation.isPending
  return (
    <div className="space-y-3 border-t border-border p-4">
      {preparation.catalogError ? (
        <p role="alert" className="text-xs text-error-text">
          Current project configuration: {preparation.catalogError} Cleanup uses the saved workspace
          snapshot.
        </p>
      ) : null}
      <p role="alert" className="text-xs text-error-text">
        {cleanupAlertMessage(preparation, props.generationMismatch === true)}
      </p>
      {preparation.cleanup.output ? (
        <details>
          <summary className="cursor-pointer text-xs text-text-secondary">Cleanup output</summary>
          <PlainTextBlock
            reason="terminal"
            className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs"
          >
            {preparation.cleanup.output}
          </PlainTextBlock>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {props.generationMismatch ? null : required ? (
          <Button disabled={busy} onClick={() => setClosedReview(false)}>
            Review changes
          </Button>
        ) : (
          <Button disabled={busy} onClick={props.onRetry}>
            {cleanupCompleted ? 'Retry removal' : 'Retry cleanup'}
          </Button>
        )}
        <details>
          <summary className="cursor-pointer py-2 text-xs text-error-text">Delete anyway…</summary>
          <p className="my-2 text-xs text-text-tertiary">
            Skip cleanup and remove this worktree. External resources created by setup may remain.
          </p>
          <Button variant="danger" disabled={busy} onClick={props.onDeleteAnyway}>
            Delete anyway
          </Button>
        </details>
        <details>
          <summary className="cursor-pointer py-2 text-xs text-error-text">Force remove…</summary>
          <p className="my-2 text-xs text-text-tertiary">
            Remove this worktree even if it has uncommitted changes or is locked. This cannot be
            undone.
          </p>
          <Button variant="danger" disabled={busy} onClick={props.onForceRemove}>
            Force remove
          </Button>
        </details>
      </div>
      {required && !closedReview ? (
        <PreparationReviewDialog
          entry={required}
          currentProfileName={preparation.snapshot.profile.name}
          busy={busy}
          error={state.mutation.error?.message}
          onClose={() => setClosedReview(true)}
          onDecide={(enabled) => {
            void state.mutation
              .mutateAsync({
                type: 'review-snapshot',
                definitionId: required.definition.id,
                enabled,
                expectedRevision: preparation.revision,
              })
              .then(() => setClosedReview(true))
              .catch(() => {})
          }}
        />
      ) : null}
      {state.mutation.error ? (
        <p role="alert" className="text-xs text-error-text">
          {state.mutation.error.message}
        </p>
      ) : null}
    </div>
  )
}
