import { Context, Effect, Layer } from 'effect'
import { ProviderLookupError } from '../errors'
import type { ProviderDefinition } from '../providers/provider-definition'
import { providerRegistry } from '../providers/registry'

export interface ProviderRegistryServiceShape {
  readonly get: (providerId: string) => Effect.Effect<ProviderDefinition | undefined>
  readonly getAll: () => Effect.Effect<readonly ProviderDefinition[]>
  readonly getProviderForModel: (
    modelId: string,
  ) => Effect.Effect<ProviderDefinition, ProviderLookupError>
  readonly isKnownModel: (modelId: string) => Effect.Effect<boolean>
}

export class ProviderRegistryService extends Context.Tag('@openwaggle/ProviderRegistryService')<
  ProviderRegistryService,
  ProviderRegistryServiceShape
>() {
  static readonly Live = Layer.succeed(this, {
    get: (providerId) => Effect.sync(() => providerRegistry.get(providerId)),
    getAll: () => Effect.sync(() => providerRegistry.getAll()),
    getProviderForModel: (modelId) =>
      Effect.sync(() => providerRegistry.getProviderForModel(modelId)).pipe(
        Effect.flatMap((provider) =>
          provider ? Effect.succeed(provider) : Effect.fail(new ProviderLookupError({ modelId })),
        ),
      ),
    isKnownModel: (modelId) => Effect.sync(() => providerRegistry.isKnownModel(modelId)),
  } satisfies ProviderRegistryServiceShape)
}
