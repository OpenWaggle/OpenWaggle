import type { IPty } from 'node-pty'
import { observeTerminalProcessLifecycle } from '../terminal-process-exit-observation'

interface ExitEvent {
  readonly exitCode: number
}

/** Independently controlled native lifecycle stages for ordering regressions. */
export function makeTerminalLifecycleHarness() {
  const exitListeners: Array<(event: ExitEvent) => void> = []
  const treeExitListeners: Array<(event: ExitEvent) => void> = []
  const resourceDrain = Promise.withResolvers<void>()
  let resourceSettled = false

  const emitProcessTreeExit = (exitCode = 0) => {
    for (const listener of treeExitListeners) listener({ exitCode })
  }
  const resolveResourceDrain = () => {
    if (resourceSettled) return
    resourceSettled = true
    resourceDrain.resolve()
  }
  const rejectResourceDrain = (error: Error) => {
    if (resourceSettled) return
    resourceSettled = true
    resourceDrain.reject(error)
  }
  const emitPublicExit = (exitCode = 0) => {
    for (const listener of exitListeners) listener({ exitCode })
  }
  const emitExit = (exitCode = 0) => {
    emitProcessTreeExit(exitCode)
    resolveResourceDrain()
    emitPublicExit(exitCode)
  }

  const install = (pty: IPty) => {
    Reflect.set(pty, 'onProcessTreeExit', (listener: (event: ExitEvent) => void) => {
      treeExitListeners.push(listener)
      return { dispose: () => undefined }
    })
    Reflect.set(pty, 'waitForResourceDrain', () => resourceDrain.promise)
    return observeTerminalProcessLifecycle(pty)
  }

  return {
    exitListeners,
    treeExitListeners,
    install,
    emitProcessTreeExit,
    resolveResourceDrain,
    rejectResourceDrain,
    emitPublicExit,
    emitExit,
  }
}
