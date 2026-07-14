import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { applyRuntimeLoadFailureToLifecycle } from '../extensions/runtime-load-failure'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { AppLogger } from '../services/logger-service'

export interface TrustedMainActivationFailureResult {
  readonly extensionId: string
  readonly status: 'failed'
  readonly errorMessage: string
}

export function describeTrustedMainActivationError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function describeTrustedMainActivationCause(cause: Cause.Cause<unknown>) {
  return describeTrustedMainActivationError(Cause.squash(cause))
}

export function trustedMainFailureResult(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly error: unknown
}): TrustedMainActivationFailureResult {
  return {
    extensionId: input.extensionPackage.id,
    status: 'failed',
    errorMessage: describeTrustedMainActivationError(input.error),
  }
}

export function recordTrustedMainActivationFailure(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
  readonly error: unknown
  readonly now: number
}) {
  return Effect.gen(function* () {
    const logger = yield* AppLogger
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const nextLifecycle = applyRuntimeLoadFailureToLifecycle({
      extensionPackage: input.extensionPackage,
      lifecycle: input.lifecycle,
      error: input.error,
      now: input.now,
    })

    yield* lifecycleRepository.upsert(nextLifecycle).pipe(
      Effect.catchAll((error) =>
        logger.warn('extension-trusted-main', 'Failed to persist trusted main activation failure', {
          extensionId: input.extensionPackage.id,
          error: describeTrustedMainActivationError(error),
        }),
      ),
    )
    yield* logger.warn('extension-trusted-main', 'Trusted main extension activation failed', {
      extensionId: input.extensionPackage.id,
      error: describeTrustedMainActivationError(input.error),
    })
  })
}

export function recordTrustedMainActivationFailureResult(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
  readonly error: unknown
  readonly now: number
}) {
  return recordTrustedMainActivationFailure(input).pipe(
    Effect.catchAllCause(() => Effect.void),
    Effect.as(trustedMainFailureResult(input)),
  )
}

export function recordTrustedMainActivationCauseFailureResult(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
  readonly cause: Cause.Cause<unknown>
  readonly now: number
}) {
  const error = Cause.squash(input.cause)
  return recordTrustedMainActivationFailureResult({ ...input, error })
}
