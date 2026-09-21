import type { ActionCatalog } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import type {
  PreparationExecution,
  PreparationOperation,
  WorkspacePreparation,
} from '@shared/types/workspace-preparation'
import { useId, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useNativeActions } from '../hooks/useNativeActions'
import { useWorkspacePreparation } from '../hooks/useWorkspacePreparation'
import { PreparationReviewDialog } from './PreparationReviewDialog'

type Mutation = ReturnType<typeof useWorkspacePreparation>['mutation']
type Change = Exclude<PreparationOperation, { type: 'preparation' }>
const SETUP_BUTTON_LABELS: Record<PreparationExecution['status'], string> = {
  idle: 'Run setup',
  running: 'Setting up…',
  succeeded: 'Run setup',
  failed: 'Retry setup',
  skipped: 'Run setup',
  'review-required': 'Run setup',
}
export function WorkspacePreparationStatus({ scope }: { readonly scope: ActionManagementScope }) {
  const catalog = useNativeActions(scope)
  const preparation = useWorkspacePreparation(scope)
  const state = preparation.data
  const configured = hasPreparation(catalog.data)
  const error = preparation.mutation.error ?? preparation.error
  if (!state && !configured && !preparation.error) return null
  return (
    <section
      aria-label="Workspace preparation status"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-text-secondary">Workspace preparation</h3>
        <span className="text-xs text-text-tertiary">
          {state?.snapshot.profile.name ?? 'Choose profile'}
        </span>
      </div>
      {state ? (
        <PreparationSnapshotDetails state={state} mutation={preparation.mutation} />
      ) : (
        <WorkspaceProfilePicker
          profiles={catalog.data?.profiles ?? []}
          mutation={preparation.mutation}
        />
      )}
      {error ? (
        <p role="alert" className="text-xs text-error-text">
          {error.message}
        </p>
      ) : null}
    </section>
  )
}
function WorkspaceProfilePicker({
  profiles,
  mutation,
}: {
  readonly profiles: ActionCatalog['profiles']
  readonly mutation: Mutation
}) {
  const id = useId()
  const [profileId, setProfileId] = useState('default')
  return (
    <div className="space-y-3">
      <label htmlFor={id} className="block text-xs text-text-tertiary">
        Profile for this workspace
      </label>
      <select
        id={id}
        className="min-h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm"
        value={profileId}
        onChange={(event) => setProfileId(event.target.value)}
      >
        {profiles.map(({ definition }) => (
          <option key={definition.id} value={definition.id}>
            {definition.name}
          </option>
        ))}
      </select>
      <Button
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate({ type: 'select-preparation', profileId, expectedRevision: 0 })
        }
      >
        Use this profile
      </Button>
      <p className="text-xs leading-5 text-text-tertiary">
        New worktrees run setup before their first turn. Existing checkouts run it only when you
        choose Run setup.
      </p>
    </div>
  )
}
function PreparationSnapshotDetails({
  state,
  mutation,
}: {
  readonly state: WorkspacePreparation
  readonly mutation: Mutation
}) {
  const [closedReviewRevision, setClosedReviewRevision] = useState<number | null>(null)
  const [manualReview, setManualReview] = useState(false)
  const required = state.snapshot.definitions.find(
    (entry) => entry.definition.phase === 'setup' && entry.review === 'required',
  )
  const blocked = state.setup.status === 'failed' || state.setup.status === 'review-required'
  const automaticReview =
    state.setup.status === 'review-required' && closedReviewRevision !== state.revision
  const showReview = required && (manualReview || automaticReview)
  const busy = mutation.isPending || state.setup.status === 'running'
  function apply(operation: Change) {
    mutation.mutate(operation, { onSuccess: () => setManualReview(false) })
  }
  return (
    <>
      <p className="text-xs text-text-tertiary">Setup: {state.setup.status.replaceAll('-', ' ')}</p>
      <PreparationOutput execution={state.setup} />
      <div className="flex flex-wrap gap-2">
        {required ? (
          <Button disabled={busy} onClick={() => setManualReview(true)}>
            Review changes
          </Button>
        ) : null}
        <Button
          disabled={busy || Boolean(required)}
          onClick={() =>
            apply({ type: 'run-preparation', phase: 'setup', expectedRevision: state.revision })
          }
        >
          {SETUP_BUTTON_LABELS[state.setup.status]}
        </Button>
        {blocked ? (
          <Button
            disabled={busy}
            onClick={() =>
              apply({ type: 'skip-preparation', phase: 'setup', expectedRevision: state.revision })
            }
          >
            Continue anyway
          </Button>
        ) : null}
      </div>
      {state.updateAvailable ? (
        <details className="text-xs text-text-tertiary">
          <summary className="cursor-pointer">A newer profile version is available</summary>
          <p className="my-2 leading-5">
            Adopting it replaces this workspace’s setup and cleanup snapshot and clears its prepared
            environment. Setup will need to complete again.
          </p>
          <Button
            disabled={busy}
            onClick={() => apply({ type: 'adopt-preparation', expectedRevision: state.revision })}
          >
            Adopt updated profile
          </Button>
        </details>
      ) : null}
      {showReview ? (
        <PreparationReviewDialog
          entry={required}
          busy={busy}
          error={mutation.error?.message}
          onClose={() => {
            setClosedReviewRevision(state.revision)
            setManualReview(false)
          }}
          onDecide={(enabled) =>
            apply({
              type: 'review-snapshot',
              definitionId: required.definition.id,
              enabled,
              expectedRevision: state.revision,
            })
          }
        />
      ) : null}
    </>
  )
}
function PreparationOutput({ execution }: { readonly execution: PreparationExecution }) {
  return (
    <>
      {execution.error ? (
        <p role="alert" className="text-xs leading-5 text-error-text">
          {execution.error}
        </p>
      ) : null}
      {execution.output ? (
        <details>
          <summary className="cursor-pointer text-xs text-text-tertiary">
            Setup output{execution.truncated ? ' · older output trimmed' : ''}
          </summary>
          <PlainTextBlock
            reason="terminal"
            className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap bg-bg p-2 text-xs"
          >
            {execution.output}
          </PlainTextBlock>
        </details>
      ) : null}
    </>
  )
}

function hasPreparation(catalog: ActionCatalog | undefined) {
  return Boolean(catalog?.preparation.length) || (catalog?.profiles.length ?? 0) > 1
}
