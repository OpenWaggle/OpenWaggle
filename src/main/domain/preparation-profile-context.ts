import type { ActionManifest, PreparationProfile } from '@shared/types/action-definitions'
import { effectivePreparation } from './effective-project-definitions'

export function assertPreparationProfileCanBeDeleted(
  local: ActionManifest,
  shared: ActionManifest,
  storage: 'local' | 'project',
  id: string,
) {
  if (id === 'default') throw new Error('The default preparation profile cannot be deleted.')
  const referenced = effectivePreparation(local.preparation, shared.preparation).some(
    ({ definition }) => definition.profileId === id,
  )
  const sharedNeedsProfile =
    storage === 'project' && shared.preparation.some((definition) => definition.profileId === id)
  const fallback = storage === 'local' ? shared : local
  if (
    sharedNeedsProfile ||
    (referenced && !fallback.profiles.some((profile) => profile.id === id))
  ) {
    throw new Error('Remove the profile’s setup and cleanup definitions first.')
  }
}

export function sharePreparationProfile(
  local: ActionManifest,
  shared: ActionManifest,
  profileId: string,
) {
  if (profileId === 'default' || shared.profiles.some((profile) => profile.id === profileId)) {
    return shared
  }
  const profile = local.profiles.find((profile) => profile.id === profileId)
  if (!profile) throw new Error(`Preparation profile ${profileId} is missing.`)
  return { ...shared, profiles: [...shared.profiles, profile] }
}

/** Each id's first profile, as `find` would return it. */
function firstProfileById(profiles: readonly PreparationProfile[]) {
  const byId = new Map<string, PreparationProfile>()
  for (const profile of profiles) if (!byId.has(profile.id)) byId.set(profile.id, profile)
  return byId
}

/** Private preparation must remain usable after its shared profile disappears. */
export function retainPrivatePreparationProfiles(
  manifest: ActionManifest,
  previousProfiles: readonly PreparationProfile[],
  sharedProfiles: readonly PreparationProfile[],
  releasedProfileId?: string,
) {
  const profiles = new Map(manifest.profiles.map((profile) => [profile.id, profile]))
  const previousById = firstProfileById(previousProfiles)
  const sharedById = firstProfileById(sharedProfiles)
  for (const definition of manifest.preparation) {
    const id = definition.profileId
    if (id === 'default' || profiles.has(id)) continue
    // An explicit local delete restores the shared profile instead of re-creating its override.
    if (id === releasedProfileId && sharedById.has(id)) continue
    const profile = previousById.get(id) ?? sharedById.get(id)
    if (!profile) throw new Error(`Preparation profile ${id} is missing.`)
    profiles.set(id, profile)
  }
  return (
    profiles.size === manifest.profiles.length
      ? manifest
      : { ...manifest, profiles: [...profiles.values()] }
  ) satisfies ActionManifest
}
