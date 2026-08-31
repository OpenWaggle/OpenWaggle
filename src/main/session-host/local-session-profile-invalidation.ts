const invalidators = new Set<(profileId: string) => void>()
export interface LocalSessionProfileAdmissionRefreshOptions {
  readonly consumeExistingFence?: boolean
}

const admissionRefreshers = new Set<
  (profileId?: string, options?: LocalSessionProfileAdmissionRefreshOptions) => Promise<void>
>()
const admissionFencers = new Set<(profileName: string) => Promise<void>>()

export function installLocalSessionProfileInvalidator(invalidator: (profileId: string) => void) {
  invalidators.add(invalidator)
  return () => invalidators.delete(invalidator)
}

export function disconnectLocalSessionProfile(profileId: string) {
  for (const invalidate of invalidators) invalidate(profileId)
}

export function installLocalSessionProfileAdmissionRefresher(
  refresher: (
    profileId?: string,
    options?: LocalSessionProfileAdmissionRefreshOptions,
  ) => Promise<void>,
) {
  admissionRefreshers.add(refresher)
  return () => admissionRefreshers.delete(refresher)
}

export async function refreshLocalSessionProfileAdmissions(
  profileId?: string,
  options?: LocalSessionProfileAdmissionRefreshOptions,
) {
  await Promise.all([...admissionRefreshers].map((refresh) => refresh(profileId, options)))
}

export function installLocalSessionProfileAdmissionFencer(
  fencer: (profileName: string) => Promise<void>,
) {
  admissionFencers.add(fencer)
  return () => admissionFencers.delete(fencer)
}

export async function fenceLocalSessionProfileAdmissions(profileName: string) {
  await Promise.all([...admissionFencers].map((fence) => fence(profileName)))
}
