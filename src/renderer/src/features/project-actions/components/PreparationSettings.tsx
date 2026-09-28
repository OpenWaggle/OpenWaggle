import type { ActionCatalog, ActionCatalogEdit } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { useId, useState } from 'react'
import { useEditActionCatalog, useNativeActions } from '../hooks/useNativeActions'
import { useActionPanelStore } from '../state/action-panel-store'
import { PreparationDefinitionCard } from './PreparationDefinitionCard'
import { PreparationProfileManager } from './PreparationProfileManager'

export function PreparationSettings(props: {
  readonly scope: ActionManagementScope
  readonly catalog: ActionCatalog
}) {
  const profileLabel = useId()
  const [profileId, setProfileId] = useState('default')
  const [error, setError] = useState<string | null>(null)
  const mutation = useEditActionCatalog(props.scope)
  const catalogQuery = useNativeActions(props.scope)
  const profile =
    props.catalog.profiles.find(({ definition }) => definition.id === profileId) ??
    props.catalog.profiles[0]
  const multipleProfiles = props.catalog.profiles.length > 1
  const openPanel = useActionPanelStore.getState().openPanel
  function openReview(id: string) {
    const entry = props.catalog.preparation.find(({ definition }) => definition.id === id)
    if (!entry) return
    const profileName =
      props.catalog.profiles.find(({ definition }) => definition.id === entry.definition.profileId)
        ?.definition.name ?? entry.definition.profileId
    openPanel({
      kind: 'review',
      projectPath: props.scope.projectPath,
      review: {
        entry,
        profileName,
        showProfile: multipleProfiles,
        automatic: false,
        decide: async (enabled) => {
          const latest = (await catalogQuery.refetch()).data ?? props.catalog
          return mutation.mutateAsync({
            revision: latest.revision,
            edit: { type: 'review-preparation', id, enabled },
          })
        },
      },
    })
  }
  async function apply(edit: ActionCatalogEdit) {
    try {
      await mutation.mutateAsync({ revision: props.catalog.revision, edit })
      setError(null)
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
      {multipleProfiles ? (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={profileLabel} className="text-sm text-text-secondary">
            Setup profile
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
      ) : null}
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
          onEdit={() =>
            openPanel({
              kind: 'preparation',
              scope: props.scope,
              phase,
              profileId: profile?.definition.id ?? 'default',
              origin: 'settings',
            })
          }
          onReview={openReview}
          apply={apply}
        />
      ))}
      <PreparationProfileManager
        profile={profile}
        multipleProfiles={multipleProfiles}
        busy={mutation.isPending}
        apply={apply}
        onSelect={setProfileId}
      />
      {error ? (
        <p role="alert" className="text-sm text-error-text">
          {error}
        </p>
      ) : null}
    </section>
  )
}
