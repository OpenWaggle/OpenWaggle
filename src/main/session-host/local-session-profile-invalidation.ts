const invalidators = new Set<(profileId: string) => void>()
const admissionRefreshers = new Set<(profileId?: string) => Promise<void>>()

export function installLocalSessionProfileInvalidator(invalidator: (profileId: string) => void) {
  invalidators.add(invalidator)
  return () => invalidators.delete(invalidator)
}

export function disconnectLocalSessionProfile(profileId: string) {
  for (const invalidate of invalidators) invalidate(profileId)
}

export function installLocalSessionProfileAdmissionRefresher(
  refresher: (profileId?: string) => Promise<void>,
) {
  admissionRefreshers.add(refresher)
  return () => admissionRefreshers.delete(refresher)
}

export async function refreshLocalSessionProfileAdmissions(profileId?: string) {
  await Promise.all([...admissionRefreshers].map((refresh) => refresh(profileId)))
}
