import type { Pty } from './terminal-pty-backend'
import { normalizeTerminalExitCode } from './terminal-exit-code'
import type {
  TerminalProcessExitObservation,
  TerminalResourceDrainObservation,
} from './terminal-records'
import { terminalBackendProcess } from './terminal-pty-backend-fields'

/** Install once, immediately after spawn, so even a pre-attach exit is retained. */
export function observeTerminalProcessExit(pty: Pty) {
  let resolveExit: () => void = () => undefined
  let disposed = false
  const notifyExit = (exitCode: unknown) => {
    if (observation.exitCode !== null) return
    observation.exitCode = normalizeTerminalExitCode(exitCode)
    resolveExit()
  }
  const observation: TerminalProcessExitObservation = {
    whenExited: new Promise<void>((resolve) => {
      resolveExit = resolve
    }),
    exitCode: null,
    notifyExit,
    dispose: () => {
      if (disposed) return
      disposed = true
      subscription.dispose()
    },
  }
  const subscription = pty.onExit(({ exitCode }) => {
    notifyExit(exitCode)
  })
  // The public event is the final node-pty lifecycle stage. Dispose its
  // subscription automatically even when the owning runtime has already
  // released native resources after a forced Windows shutdown.
  void observation.whenExited.then(() => subscription.dispose())
  return observation
}

function observeNativeProcessTreeExit(pty: Pty) {
  const event: unknown = terminalBackendProcess(pty).onProcessTreeExit
  if (typeof event !== 'function') return null

  let resolveExit: () => void = () => undefined
  let subscription: { readonly dispose: () => void } | null = null
  let disposed = false
  const observation: TerminalProcessExitObservation = {
    whenExited: new Promise<void>((resolve) => {
      resolveExit = resolve
    }),
    exitCode: null,
    notifyExit: (exitCode) => {
      if (observation.exitCode !== null) return
      observation.exitCode = normalizeTerminalExitCode(exitCode)
      resolveExit()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      subscription?.dispose()
    },
  }
  const candidate: unknown = Reflect.apply(event, pty, [
    ({ exitCode }: { readonly exitCode: unknown }) => observation.notifyExit(exitCode),
  ])
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof ('dispose' in candidate ? candidate.dispose : undefined) !== 'function'
  ) {
    return null
  }
  const dispose: unknown = 'dispose' in candidate ? candidate.dispose : undefined
  if (typeof dispose !== 'function') return null
  subscription = {
    dispose: () => {
      Reflect.apply(dispose, candidate, [])
    },
  }
  return observation
}

function observeResourceDrain(
  pty: Pty,
  exit: TerminalProcessExitObservation,
  requireNative: boolean,
) {
  const waitForResourceDrain: unknown = terminalBackendProcess(pty).waitForResourceDrain
  let status: TerminalResourceDrainObservation['status'] = 'pending'

  let drain: Promise<boolean>
  if (typeof waitForResourceDrain === 'function') {
    try {
      const candidate: unknown = Reflect.apply(waitForResourceDrain, pty, [])
      if (
        candidate === null ||
        (typeof candidate !== 'object' && typeof candidate !== 'function') ||
        typeof ('then' in candidate ? candidate.then : undefined) !== 'function'
      ) {
        throw new Error('The terminal backend returned an invalid resource-drain promise.')
      }
      drain = Promise.resolve(candidate).then(
        () => true,
        () => false,
      )
    } catch (error) {
      if (requireNative) throw error
      drain = Promise.resolve(false)
    }
  } else {
    if (requireNative) throw new Error('The terminal backend cannot observe resource drain.')
    // Compatibility for callers outside the production runner.
    drain = exit.whenExited.then(() => true)
  }

  const whenDrained = drain.then((drained) => {
    status = drained ? 'drained' : 'failed'
    return drained
  })
  const observation: TerminalResourceDrainObservation = {
    whenDrained,
    get status() {
      return status
    },
  }
  return observation
}

/** Install every lifecycle latch immediately after spawn, before renderer attachment. */
export function observeTerminalProcessLifecycle(
  pty: Pty,
  requirements: {
    readonly requireProcessTreeExit?: boolean
    readonly requireResourceDrain?: boolean
  } = {},
) {
  const nativeTreeExit = observeNativeProcessTreeExit(pty)
  if (requirements.requireProcessTreeExit && nativeTreeExit === null) {
    throw new Error('The terminal backend returned an invalid process-tree-exit subscription.')
  }
  let exit: TerminalProcessExitObservation | null = null
  try {
    exit = observeTerminalProcessExit(pty)
    return {
      exit,
      processTreeExit: nativeTreeExit ?? exit,
      resourceDrain: observeResourceDrain(pty, exit, requirements.requireResourceDrain === true),
    }
  } catch (error) {
    nativeTreeExit?.dispose()
    exit?.dispose()
    throw error
  }
}
