import { EventEmitter } from 'node:events'
import type { Unsubscribe } from '../../ports/desktop-shell/shell-events'
import type { ShellProcessExit } from '../../ports/desktop-shell/system-integration'

/**
 * App-level shell events that more than one Electrobun adapter observes: the windows adapter
 * announces `window-all-closed`, the update engine `before-quit-for-update`, and the lifecycle
 * adapter re-emits Electrobun's `reopen` as `activate`, the renderer heartbeat reports a dead
 * page with `process-gone`. Electron raises these on its `app`;
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

const PROCESS_GONE = 'process-gone'

/**
 * A renderer (or helper) process of the web engine ended. The renderer heartbeat
 * (RendererSurfaces) emits `process-gone` with a `ShellProcessExit` on this emitter.
 */
export function onProcessGone(listener: (exit: ShellProcessExit) => void): Unsubscribe {
  const handler = (exit: ShellProcessExit) => listener(exit)
  emitter.on(PROCESS_GONE, handler)
  return () => {
    emitter.off(PROCESS_GONE, handler)
  }
}
