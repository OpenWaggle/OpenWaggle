import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'

export interface LocalSessionMutationAdmission {
  readonly caller: LocalSessionCallerIdentity
  readonly release: () => void
}

export interface LocalSessionObservationAdmission extends LocalSessionMutationAdmission {
  readonly refreshCaller?: () => Promise<LocalSessionCallerIdentity>
  readonly signal?: AbortSignal
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

export function acquireLocalSessionObservationAdmission(
  input: {
    readonly observationAdmission?: () => Promise<LocalSessionObservationAdmission>
  },
  caller: LocalSessionCallerIdentity,
): Effect.Effect<LocalSessionObservationAdmission, Error> {
  return input.observationAdmission
    ? Effect.tryPromise({
        try: input.observationAdmission,
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    : Effect.succeed({
        caller,
        release: () => undefined,
      })
}
