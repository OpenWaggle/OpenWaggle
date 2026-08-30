import { dispatchHostBackedSessionGuiOperation } from '../application/host-ui-session-operation-dispatcher'
import { hostHandle as typedHandle } from './typed-ipc'

export function registerSessionsHandlers(): void {
  typedHandle('sessions:list', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:list', args),
  )
  typedHandle('sessions:list-archived-branches', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:list-archived-branches', args),
  )
  typedHandle('sessions:get-tree', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:get-tree', args),
  )
  typedHandle('sessions:get-workspace', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:get-workspace', args),
  )
  typedHandle('sessions:navigate-tree', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:navigate-tree', args),
  )
  typedHandle('sessions:rename-branch', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:rename-branch', args),
  )
  typedHandle('sessions:archive-branch', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:archive-branch', args),
  )
  typedHandle('sessions:restore-branch', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:restore-branch', args),
  )
  typedHandle('sessions:update-tree-ui-state', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:update-tree-ui-state', args),
  )
}
