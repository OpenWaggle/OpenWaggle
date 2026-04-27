import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { ProviderAuthService } from '../../ports/provider-auth-service'
import { setPiProviderApiKey } from './pi-provider-catalog'

export const PiProviderAuthLive = Layer.succeed(
  ProviderAuthService,
  ProviderAuthService.of({
    setApiKey: (providerId, apiKey) =>
      Effect.try({
        try: () => setPiProviderApiKey(providerId, apiKey),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }),
)
