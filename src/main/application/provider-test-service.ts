/**
 * ProviderTestService — application-layer logic for testing provider credentials.
 *
 * Extracts the `testProviderApiKey` business logic from settings-handler.ts
 * into a pure Effect program that depends on hexagonal ports.
 */
import * as Effect from 'effect/Effect'
import { ProviderProbeService } from '../ports/provider-probe-service'
import { ProviderService } from '../ports/provider-service'

interface TestCredentialsSuccess {
  readonly success: true
}

interface TestCredentialsFailure {
  readonly success: false
  readonly error: string
}

type TestCredentialsResult = TestCredentialsSuccess | TestCredentialsFailure

/** Test a provider's credentials through a minimal Pi session prompt. */
export function testCredentials(providerId: string, apiKey: string, projectPath?: string | null) {
  return Effect.gen(function* () {
    const providerService = yield* ProviderService
    const providerProbeService = yield* ProviderProbeService

    // Look up the provider
    const provider = yield* providerService.get(providerId, projectPath)
    if (!provider) {
      return {
        success: false,
        error: `Unknown provider: ${providerId}`,
      } satisfies TestCredentialsFailure
    }

    const normalizedApiKey = apiKey.trim() === '' ? undefined : apiKey

    const result = yield* providerProbeService
      .probeCredentials({
        providerId: provider.id,
        modelId: provider.testModel,
        apiKey: normalizedApiKey,
        projectPath,
      })
      .pipe(
        Effect.map((): TestCredentialsResult => ({ success: true })),
        Effect.catchAll((err) =>
          Effect.succeed({
            success: false,
            error: err.message || 'Provider returned an error while testing credentials',
          } satisfies TestCredentialsFailure),
        ),
      )

    return result
  })
}

export type { TestCredentialsResult }
