import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'

export interface LocalSessionMutationAdmission {
  readonly caller: LocalSessionCallerIdentity
  readonly release: () => void
}

export function acquireLocalSessionMutationAdmission(
  input: {
    readonly mutationAdmission?: () => Promise<LocalSessionMutationAdmission>
  },
  caller: LocalSessionCallerIdentity,
) {
  return input.mutationAdmission
    ? Effect.tryPromise({
        try: input.mutationAdmission,
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    : Effect.succeed({ caller, release: () => undefined })
}
