import { Context, type Effect } from 'effect'

export interface ProviderProbeInput {
  readonly providerId: string
  readonly modelId: string
  readonly apiKey?: string
  readonly projectPath?: string | null
}

export interface ProviderProbeServiceShape {
  readonly probeCredentials: (input: ProviderProbeInput) => Effect.Effect<void, Error>
}

export class ProviderProbeService extends Context.Tag('@openwaggle/ProviderProbeService')<
  ProviderProbeService,
  ProviderProbeServiceShape
>() {}
