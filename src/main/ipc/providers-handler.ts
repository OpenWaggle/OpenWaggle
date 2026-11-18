import { hostHandle } from './typed-ipc'

export function registerProvidersHandlers() {
  hostHandle('providers:get-models')
}
