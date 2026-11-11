import { EventEmitter } from 'node:events'
import type { Unsubscribe } from '../../ports/desktop-shell/shell-events'

/**
 * App-level shell events that more than one Electrobun adapter observes: the windows adapter
 * announces `window-all-closed`, the update engine `before-quit-for-update`, and the lifecycle
 * adapter re-emits Electrobun's `reopen` as `activate`. Electron raises these on its `app`;
 * Electrobun has no such object, so the adapters share this one.
 */
type ShellEventName = 'window-all-closed' | 'activate' | 'before-quit-for-update' | 'resume'

const emitter = new EventEmitter()

export function emitShellEvent(name: ShellEventName) {
  emitter.emit(name)
}

export function onShellEvent(name: ShellEventName, listener: () => void): Unsubscribe {
  const handler = () => listener()
  emitter.on(name, handler)
  return () => {
    emitter.off(name, handler)
  }
}

/** Whether any listener holds this event (a `window-all-closed` listener replaces quitting). */
export function hasShellEventListener(name: ShellEventName) {
  return emitter.listenerCount(name) > 0
}
