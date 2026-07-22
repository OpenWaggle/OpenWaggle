import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

export const EmptyExtensionRuntimeLayer = Layer.mergeAll(
  Layer.succeed(ExtensionManagerService, {
    listPackages: () => Effect.succeed([]),
  }),
  Layer.succeed(ExtensionLifecycleRepository, {
    get: () => Effect.succeed(null),
    list: () => Effect.succeed([]),
    upsert: () => Effect.void,
  }),
  Layer.succeed(ExtensionProjectOverridesRepository, {
    get: () => Effect.succeed(null),
    upsert: () => Effect.void,
  }),
)
