import type { ActionManifest, PreparationProfile } from '@shared/types/action-definitions'

export function sharePreparationProfile(
  local: ActionManifest,
  shared: ActionManifest,
  profileId: string,
) {
  if (profileId === 'default' || shared.profiles.some((profile) => profile.id === profileId))
    return shared
  const profile = local.profiles.find((profile) => profile.id === profileId)
  if (!profile) throw new Error(`Preparation profile ${profileId} is missing.`)
  return { ...shared, profiles: [...shared.profiles, profile] }
}

/** Private preparation must remain usable after its shared profile disappears. */
export function retainPrivatePreparationProfiles(
  manifest: ActionManifest,
  previousProfiles: readonly PreparationProfile[],
  sharedProfiles: readonly PreparationProfile[],
): ActionManifest {
  const profiles = new Map(manifest.profiles.map((profile) => [profile.id, profile]))
  for (const definition of manifest.preparation) {
    const id = definition.profileId
    if (id === 'default' || profiles.has(id)) continue
    const profile =
      previousProfiles.find((candidate) => candidate.id === id) ??
      sharedProfiles.find((candidate) => candidate.id === id)
    if (!profile) throw new Error(`Preparation profile ${id} is missing.`)
    profiles.set(id, profile)
  }
  return profiles.size === manifest.profiles.length
    ? manifest
    : { ...manifest, profiles: [...profiles.values()] }
}
