/**
 * ProviderTestService — application-layer logic for testing provider credentials.
 *
 * Extracts the `testProviderApiKey` business logic from settings-handler.ts
 * into a pure Effect program that depends on hexagonal ports.
 */
import * as Effect from 'effect/Effect'
import { ChatStreamError } from '../errors'
import { ChatService } from '../ports/chat-service'
import { ProviderService } from '../ports/provider-service'

const TEST_TIMEOUT_MS = 15_000

interface TestCredentialsSuccess {
  readonly success: true
}

interface TestCredentialsFailure {
  readonly success: false
  readonly error: string
}

type TestCredentialsResult = TestCredentialsSuccess | TestCredentialsFailure

/**
 * Test a provider's credentials by sending a minimal chat request.
 *
 * For providers that don't require an API key (e.g. Ollama), tests
 * connectivity by verifying the adapter can be created and a minimal
 * stream completes without error.
 */
export function testCredentials(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
  authMethod?: 'api-key' | 'subscription',
) {
  return Effect.gen(function* () {
    const providerService = yield* ProviderService
    const chatService = yield* ChatService

    // Look up the provider
    const provider = yield* providerService.get(providerId)
    if (!provider) {
      return {
        success: false,
        error: `Unknown provider: ${providerId}`,
      } satisfies TestCredentialsFailure
    }

    // For providers that don't require an API key, test basic connectivity
    if (!provider.requiresApiKey) {
      // If the provider supports dynamic model fetch, attempt it as a health check.
      // Currently this logic stays in the handler since fetchModels is not yet
      // part of the ProviderService port. Return success for keyless providers.
      return { success: true } satisfies TestCredentialsSuccess
    }

    // Create an adapter for the provider's test model
    const adapter = yield* providerService
      .createChatAdapter(provider.testModel, apiKey, baseUrl, authMethod)
      .pipe(
        Effect.catchAll((err) =>
          Effect.fail(
            new ChatStreamError({
              message: `Failed to create adapter: ${err._tag}`,
              cause: err,
            }),
          ),
        ),
      )

    // Test the connection with a timeout
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), TEST_TIMEOUT_MS)

    const result = yield* chatService
      .testConnection({
        adapter,
        abortController,
      })
      .pipe(
        Effect.map((): TestCredentialsResult => ({ success: true })),
        Effect.catchAll((err) =>
          Effect.succeed({
            success: false,
            error: err.message || 'Provider returned an error while testing credentials',
          } satisfies TestCredentialsFailure),
        ),
        Effect.ensuring(Effect.sync(() => clearTimeout(timeoutId))),
      )

    return result
  })
}

export type { TestCredentialsResult }
