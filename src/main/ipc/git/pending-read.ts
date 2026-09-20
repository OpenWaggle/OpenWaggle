const MAX_PENDING_READ_AGE_MS = 30_000

export interface PendingGitRead<T> {
  readonly promise: Promise<T>
  readonly startedAt: number
}

/** A hung local Git child must not prevent a later manual refresh from trying again. */
export function joinPendingGitRead<T>(
  entry: PendingGitRead<T> | undefined,
): Promise<T> | undefined {
  if (!entry) return undefined
  const age = Date.now() - entry.startedAt
  return age >= 0 && age < MAX_PENDING_READ_AGE_MS ? entry.promise : undefined
}
