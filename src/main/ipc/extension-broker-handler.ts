import { hostHandle } from './typed-ipc'

export function registerExtensionBrokerHandlers(): void {
  hostHandle('extensions:invoke')
}
