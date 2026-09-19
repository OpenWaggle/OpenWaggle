import { dispatchHostBackedSessionGuiOperation } from '../application/host-ui-session-operation-dispatcher'
import { hostHandle as typedHandle } from './typed-ipc'

export function registerSessionCatalogHandlers() {
  typedHandle('sessions:list-by-ids', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:list-by-ids', args),
  )
  typedHandle('sessions:list-page', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:list-page', args),
  )
  typedHandle('sessions:list-hive-page', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:list-hive-page', args),
  )
}
