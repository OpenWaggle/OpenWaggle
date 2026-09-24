import type {
  ActionCatalog,
  ActionCatalogEdit,
  ActionStorage,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { useId, useState } from 'react'
import { useEditActionCatalog } from '../hooks/useNativeActions'
import { PreparationDefinitionCard } from './PreparationDefinitionCard'
import { PreparationEditor } from './PreparationEditor'
import { PreparationProfileManager } from './PreparationProfileManager'
import { PreparationReviewDialog } from './PreparationReviewDialog'

export function PreparationSettings(props: {
  readonly scope: ActionManagementScope
  readonly catalog: ActionCatalog
}) {
  const profileLabel = useId()
  const [profileId, setProfileId] = useState('default')
  const [editor, setEditor] = useState<{
    definition: PreparationDefinition
    source: ActionStorage
  } | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mutation = useEditActionCatalog(props.scope)
  const profile =
    props.catalog.profiles.find(({ definition }) => definition.id === profileId) ??
    props.catalog.profiles[0]
  const review = props.catalog.preparation.find(({ definition }) => definition.id === reviewId)
  async function apply(edit: ActionCatalogEdit) {
    try {
      await mutation.mutateAsync({ revision: props.catalog.revision, edit })
      setError(null)
      setReviewId(null)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update preparation.')
      return false
    }
  }
  return (
    <section aria-label="Workspace preparation" className="space-y-4 border-t border-border pt-6">
      <header>
        <h2 className="text-base font-semibold">Workspace preparation</h2>
        <p className="mt-2 text-sm leading-6 text-text-tertiary">
          Setup and cleanup for worktrees created by OpenWaggle. Each workspace keeps the profile
          version it started with. Shared commands need your review and local enablement.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={profileLabel} className="text-sm text-text-secondary">
          Preparation profile
        </label>
        <select
          id={profileLabel}
          className="min-h-10 rounded-lg border border-border bg-bg px-3 text-sm"
          value={profile?.definition.id ?? 'default'}
          onChange={(event) => setProfileId(event.target.value)}
        >
          {props.catalog.profiles.map(({ definition }) => (
            <option key={definition.id} value={definition.id}>
              {definition.name}
            </option>
          ))}
        </select>
      </div>
      {(['setup', 'cleanup'] as const).map((phase) => (
        <PreparationDefinitionCard
          key={phase}
          data={{
            phase,
            profileId: profile?.definition.id ?? 'default',
            entry: props.catalog.preparation.find(
              ({ definition }) =>
                definition.profileId === profile?.definition.id && definition.phase === phase,
            ),
          }}
          busy={mutation.isPending}
          onEdit={setEditor}
          onReview={setReviewId}
          apply={apply}
        />
      ))}
      <PreparationProfileManager
        profile={profile}
        busy={mutation.isPending}
        apply={apply}
        onSelect={setProfileId}
      />
      {error ? (
        <p role="alert" className="text-sm text-error-text">
          {error}
        </p>
      ) : null}
      {editor ? (
        <PreparationEditor
          scope={props.scope}
          definition={editor.definition}
          source={editor.source}
          catalog={props.catalog}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {review ? (
        <PreparationReviewDialog
          entry={review}
          currentProfileName={
            props.catalog.profiles.find(
              ({ definition }) => definition.id === review.definition.profileId,
            )?.definition.name ?? review.definition.profileId
          }
          busy={mutation.isPending}
          error={error}
          onClose={() => setReviewId(null)}
          onDecide={(enabled) =>
            void apply({ type: 'review-preparation', id: review.definition.id, enabled })
          }
        />
      ) : null}
    </section>
  )
}
