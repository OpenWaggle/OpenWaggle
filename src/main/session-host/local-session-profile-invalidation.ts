const invalidators = new Set<(profileId: string) => void>()

export function installLocalSessionProfileInvalidator(invalidator: (profileId: string) => void) {
  invalidators.add(invalidator)
  return () => invalidators.delete(invalidator)
}

export function disconnectLocalSessionProfile(profileId: string) {
  for (const invalidate of invalidators) invalidate(profileId)
}
