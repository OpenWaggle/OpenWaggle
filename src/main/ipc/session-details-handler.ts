import { dispatchHostBackedSessionGuiOperation } from '../application/host-ui-session-operation-dispatcher'
import { hostHandle as typedHandle } from './typed-ipc'

export function registerSessionDetailsHandlers(): void {
  typedHandle('sessions:list-details', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:list-details', args),
  )
  typedHandle('sessions:get-detail', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:get-detail', args),
  )
  typedHandle('sessions:turn-checkpoints:list', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:turn-checkpoints:list', args),
  )
  typedHandle('sessions:turn-diff:get', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:turn-diff:get', args),
  )
  typedHandle('sessions:pins:list', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:list', args),
  )
  typedHandle('sessions:pins:pin', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:pin', args),
  )
  typedHandle('sessions:pins:unpin', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:unpin', args),
  )
  typedHandle('sessions:pins:move', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:move', args),
  )
  typedHandle('sessions:create', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:create', args),
  )
  typedHandle('sessions:fork-to-new', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:fork-to-new', args),
  )
  typedHandle('sessions:clone-to-new', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:clone-to-new', args),
  )
  typedHandle('sessions:dismiss-interrupted-run', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:dismiss-interrupted-run', args),
  )
  typedHandle('sessions:delete', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:delete', args),
  )
  typedHandle('sessions:archive', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:archive', args),
  )
  typedHandle('sessions:unarchive', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:unarchive', args),
  )
  typedHandle('sessions:list-archived', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:list-archived', args),
  )
  typedHandle('sessions:update-title', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:update-title', args),
  )
  typedHandle('sessions:set-authorization-mode', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:set-authorization-mode', args),
  )
}
