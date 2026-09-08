import { Effect } from 'effect'
import type { SettingsServiceShape } from '../services/settings-service'

export type BrowserPreviewAutomationAccessGuard = <A>(
  operation: Effect.Effect<A, Error>,
) => Effect.Effect<A, Error>

function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}

export function browserPreviewAutomationPromiseEffect<A>(run: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: toError })
}

export function browserPreviewAutomationSyncEffect<A>(run: () => A) {
  return Effect.try({ try: run, catch: toError })
}

export function createBrowserPreviewAutomationAccessGuard(
  settings: SettingsServiceShape,
): BrowserPreviewAutomationAccessGuard {
  return function withAgentAccess<A>(operation: Effect.Effect<A, Error>) {
    return settings.get().pipe(
      Effect.catchAllCause(() =>
        Effect.fail(new Error('Agent browser access could not be verified.')),
      ),
      Effect.flatMap((snapshot) =>
        snapshot.enableAgentBrowserAccess
          ? operation
          : Effect.fail(new Error('Agent browser access is disabled.')),
      ),
    )
  }
}

export function browserPreviewAutomationDefaults(settings: SettingsServiceShape) {
  return settings.get().pipe(
    Effect.map((snapshot) => ({
      profileId: snapshot.browserDefaultProfileId,
      autoShow: snapshot.browserAutoShowFloatingPreview,
    })),
    Effect.catchAllCause(() =>
      Effect.fail(new Error('Browser preview preferences could not be verified.')),
    ),
  )
}
