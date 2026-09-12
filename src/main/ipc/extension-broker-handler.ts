import { invokeHostUiExtension } from '../application/host-ui-extension-operations'
import { hostHandle as typedHandle } from './typed-ipc'

export function registerExtensionBrokerHandlers(): void {
  typedHandle('extensions:invoke', (_event, input: unknown) => invokeHostUiExtension(input))
}
