import { Context, type Effect } from 'effect'

export interface ProviderAuthServiceShape {
  readonly setApiKey: (providerId: string, apiKey: string) => Effect.Effect<void, Error>
}

export class ProviderAuthService extends Context.Tag('@openwaggle/ProviderAuthService')<
  ProviderAuthService,
  ProviderAuthServiceShape
>() {}
