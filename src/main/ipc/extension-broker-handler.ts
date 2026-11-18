import { hostHandle } from './typed-ipc'

export function registerExtensionBrokerHandlers() {
  hostHandle('extensions:invoke')
}
