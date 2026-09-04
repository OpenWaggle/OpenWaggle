import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'

export interface SessionResourceInvalidation {
  readonly sessionId: SessionId
}

type SessionResourceInvalidationListener = (event: SessionResourceInvalidation) => void

const listeners = new Set<SessionResourceInvalidationListener>()

export function publishSessionResourceInvalidation(sessionId: SessionId): void {
  const event = { sessionId } satisfies SessionResourceInvalidation
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // Persistence must not fail because an observer stopped accepting events.
    }
  }
}

export function subscribeToSessionResourceInvalidations(
  listener: SessionResourceInvalidationListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emits once after a batch successfully writes or re-keys one or more resources. */
export function withSessionResourceInvalidation<A, E, R>(
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    let changed = false
    const markChanged = Effect.sync(() => {
      changed = true
    })
    const trackedRepository = SessionResourceRepository.of({
      ...repository,
      upsert: (input) => repository.upsert(input).pipe(Effect.tap(() => markChanged)),
      rekey: (input) => repository.rekey(input).pipe(Effect.tap(() => markChanged)),
    })

    return yield* effect.pipe(
      Effect.provideService(SessionResourceRepository, trackedRepository),
      Effect.ensuring(
        Effect.sync(() => {
          if (changed) publishSessionResourceInvalidation(sessionId)
        }),
      ),
    )
  })
}
