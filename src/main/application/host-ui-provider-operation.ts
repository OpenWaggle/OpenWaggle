import { SupportedModelId } from '@shared/types/brand'
import { generateDisplayName, type ProviderCatalogScope } from '@shared/types/llm'
import * as Effect from 'effect/Effect'
import { ProviderService } from '../ports/provider-service'
import { validateProjectPath } from '../utils/project-path-validation'

/**
 * Pi's provider catalog for the renderer. The `available` scope keeps every provider's metadata
 * and auth state, so the renderer still knows which providers exist, but only the models that can
 * run now. The full catalog (1,600 models in a fresh profile, 381 KB) used to cross the Host
 * connection and IPC on every launch for a composer that only offers available models
 * (renderer-load B14).
 */
export function getHostUiProviderModels(
  projectPath?: string | null,
  scope: ProviderCatalogScope = 'all',
) {
  return Effect.gen(function* () {
    const validatedProjectPath = yield* validateProjectPath(projectPath)
    const providerService = yield* ProviderService
    const providers = yield* providerService.getAll(validatedProjectPath)
    return [...providers].map((provider) => ({
      provider: provider.id,
      displayName: provider.displayName,
      apiKeyManagementUrl: provider.apiKeyManagementUrl,
      auth: provider.auth,
      models: provider.models
        .flatMap((model) => (scope === 'available' && !model.available ? [] : [model]))
        .map((model) => ({
          id: SupportedModelId(model.id),
          modelId: model.modelId,
          name: model.name ?? generateDisplayName(model.modelId),
          provider: provider.id,
          available: model.available,
          availableThinkingLevels: model.availableThinkingLevels,
          contextWindow: model.contextWindow,
          ...(model.virtual ? { virtual: true } : {}),
        })),
    }))
  })
}
