import type { LiveTerminalProcess } from './terminal-records'

export type TerminalTtySignalResult = 'signaled' | 'no-match' | 'partial' | 'unavailable'

const NATIVE_TTY_SIGNAL_PARTIAL = -2
const TTY_SIGNAL_RETRY_POLL_MS = 5

function ptyDescriptorIsOpen(live: LiveTerminalProcess) {
  const socket: unknown = Reflect.get(live.pty, '_socket')
  return (
    socket !== null &&
    typeof socket === 'object' &&
    Reflect.get(socket, 'destroyed') !== true &&
    Reflect.get(socket, 'closed') !== true
  )
}

/**
 * Signal every same-user process attached to the exact live PTY. A successful
 * native call reports only an aggregate count, so the caller must still
 * birth-check every previously observed identity: a member may have detached
 * between snapshot and sweep. In particular, zero matches is not proof that a
 * detached root is absent.
 */
export function signalLiveTerminalTtyMembers(
  live: LiveTerminalProcess,
  force: boolean,
): TerminalTtySignalResult {
  if (
    process.platform === 'win32' ||
    !ptyDescriptorIsOpen(live) ||
    live.signalTtyMembers === undefined
  ) {
    return 'unavailable'
  }
  const signaled = live.signalTtyMembers(force)
  if (signaled === NATIVE_TTY_SIGNAL_PARTIAL) return 'partial'
  if (signaled === null || signaled < 0) return 'unavailable'
  return signaled === 0 ? 'no-match' : 'signaled'
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/** Retry only side-effect-free native misses while a new PTY finishes attaching its root. */
export async function retryLiveTerminalTtySignal(
  live: LiveTerminalProcess,
  force: boolean,
  deadline: number,
): Promise<TerminalTtySignalResult> {
  let result = signalLiveTerminalTtyMembers(live, force)
  while (result === 'unavailable' && live.signalTtyMembers !== undefined && Date.now() < deadline) {
    await delay(Math.min(TTY_SIGNAL_RETRY_POLL_MS, deadline - Date.now()))
    result = signalLiveTerminalTtyMembers(live, force)
  }
  return result
}

export function terminalTtySignalResolvedRoot(result: TerminalTtySignalResult) {
  return result === 'signaled'
}
