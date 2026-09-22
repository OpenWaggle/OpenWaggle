import { useEffect, useId } from 'react'
import { useDraftPreparationProfile } from '@/features/git'
import { useActionScope, useNativeActions } from '../hooks/useNativeActions'
import { useWorkspacePreparation } from '../hooks/useWorkspacePreparation'

const MULTIPLE_PROFILES = 2
export function WorktreePreparationChoice({ projectPath }: { readonly projectPath: string }) {
  const id = useId()
  const scope = useActionScope(projectPath)
  const catalog = useNativeActions(scope)
  const preparation = useWorkspacePreparation(scope)
  const draft = useDraftPreparationProfile(projectPath)
  useEffect(() => {
    if (scope?.sessionId || !catalog.data || !draft.profileId) return
    if (!catalog.data.profiles.some(({ definition }) => definition.id === draft.profileId))
      draft.select(undefined)
  }, [catalog.data, draft.profileId, draft.select, scope?.sessionId])
  const profiles = catalog.data?.profiles ?? []
  if (profiles.length < MULTIPLE_PROFILES) return null
  const state = preparation.data
  const selection = scope?.sessionId ? state?.snapshot.profile.id : draft.profileId
  const error = preparation.mutation.error ?? preparation.error
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <label htmlFor={id} className="text-xs text-text-tertiary">
        Preparation
      </label>
      <select
        id={id}
        value={selection ?? ''}
        className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs"
        disabled={preparation.mutation.isPending || Boolean(state && state.setup.status !== 'idle')}
        onChange={(event) => {
          const profileId = event.target.value
          if (scope?.sessionId)
            preparation.mutation.mutate({
              type: 'select-preparation',
              profileId,
              expectedRevision: state?.revision ?? 0,
            })
          else draft.select(profileId)
        }}
      >
        <option disabled value="">
          Choose a profile for this worktree
        </option>
        {profiles.map(({ definition }) => (
          <option key={definition.id} value={definition.id}>
            {definition.name}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="w-full text-xs text-error-text">
          {error.message}
        </p>
      ) : null}
    </div>
  )
}
