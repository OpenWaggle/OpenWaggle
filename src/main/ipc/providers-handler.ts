import { SupportedModelId } from '@shared/types/brand'
import { generateDisplayName } from '@shared/types/llm'
import * as Effect from 'effect/Effect'
import { ProviderService } from '../ports/provider-service'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

export function registerProvidersHandlers(): void {
  typedHandle('providers:get-models', (_event, projectPath?: string | null) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      const providerSvc = yield* ProviderService
      const providers = yield* providerSvc.getAll(validatedProjectPath)
      return [...providers].map((provider) => ({
        provider: provider.id,
        displayName: provider.displayName,
        apiKeyManagementUrl: provider.apiKeyManagementUrl,
        auth: provider.auth,
        models: provider.models.map((model) => ({
          id: SupportedModelId(model.id),
          modelId: model.modelId,
          name: model.name ?? generateDisplayName(model.modelId),
          provider: provider.id,
          available: model.available,
          availableThinkingLevels: model.availableThinkingLevels,
          contextWindow: model.contextWindow,
        })),
      }))
    }),
  )
}
