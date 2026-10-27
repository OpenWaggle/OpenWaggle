import { hostHandle } from './typed-ipc'

export function registerProvidersHandlers(): void {
  hostHandle('providers:get-models')
}
