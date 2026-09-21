import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useWorkspacePreparation } from '../hooks/useWorkspacePreparation'
import { PreparationReviewDialog } from './PreparationReviewDialog'

export function WorkspaceCleanupFailure(props: {
  readonly projectPath: string
  readonly initial: WorkspacePreparation
  readonly busy: boolean
  readonly onRetry: () => void
  readonly onDeleteAnyway: () => void
}) {
  const [closedReview, setClosedReview] = useState(false)
  const state = useWorkspacePreparation({
    projectPath: props.projectPath,
    workspaceId: props.initial.workspaceId,
  })
  const preparation = state.data ?? props.initial
  const required = preparation.snapshot.definitions.find(
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
        {preparation.cleanup.error ??
          'Workspace cleanup needs attention. The worktree was retained.'}
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
        {required ? (
          <Button disabled={busy} onClick={() => setClosedReview(false)}>
            Review changes
          </Button>
        ) : (
          <Button disabled={busy} onClick={props.onRetry}>
            Retry cleanup
          </Button>
        )}
        <details>
          <summary className="cursor-pointer py-2 text-xs text-error-text">Delete anyway…</summary>
          <p className="my-2 text-xs text-text-tertiary">
            Skip the failed cleanup and remove this worktree. External resources created by setup
            may remain.
          </p>
          <Button variant="danger" disabled={busy} onClick={props.onDeleteAnyway}>
            Delete anyway
          </Button>
        </details>
      </div>
      {required && !closedReview ? (
        <PreparationReviewDialog
          entry={required}
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
