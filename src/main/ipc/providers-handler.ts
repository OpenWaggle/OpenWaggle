import { getHostUiProviderModels } from '../application/host-ui-provider-operation'
import { hostHandle as typedHandle } from './typed-ipc'

export function registerProvidersHandlers(): void {
  typedHandle('providers:get-models', (_event, projectPath?: string | null) =>
    getHostUiProviderModels(projectPath),
  )
}
