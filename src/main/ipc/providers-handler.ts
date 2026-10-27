import * as Effect from 'effect/Effect'
import { optionalHostUiProviderCatalogScope } from '../application/host-ui-operation-validation'
import { getHostUiProviderModels } from '../application/host-ui-provider-operation'
import { hostHandle as typedHandle } from './typed-ipc'

export function registerProvidersHandlers(): void {
  typedHandle('providers:get-models', (_event, projectPath, scope) =>
    Effect.flatMap(optionalHostUiProviderCatalogScope(scope), (validScope) =>
      getHostUiProviderModels(projectPath, validScope),
    ),
  )
}
