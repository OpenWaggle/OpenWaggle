import { access } from 'node:fs/promises'
import type { IPty } from 'node-pty'
import { createLogger } from '../../logger'
import { normalizeTerminalExitCode } from './terminal-exit-code'
import type { TerminalProcessIdentity } from './terminal-process-identity'
import { signalTerminalProcessIdentity } from './terminal-process-kernel-api'
import { refreshTerminalProcessPids, TERMINAL_PROCESS_SNAPSHOT_MS } from './terminal-process-tree'
import type { LiveTerminalProcess } from './terminal-records'

export { settleLiveProcessMetadata } from './terminal-process-metadata-settle'

const logger = createLogger('terminal-process-shutdown')
const EXIT_POLL_MS = 10
const FORCE_SIGNAL = 'SIGKILL'

// Keep the internal pipeline below the public 250 ms lifecycle gate so timer,
// promise, and Effect scheduling do not turn an on-deadline kill into a miss.
export const TERMINAL_SHUTDOWN_PIPELINE_MS = 200
export const TERMINAL_GRACEFUL_SHUTDOWN_MS = 100
export const TERMINAL_FORCE_SHUTDOWN_MS =
  TERMINAL_SHUTDOWN_PIPELINE_MS - TERMINAL_GRACEFUL_SHUTDOWN_MS
export const TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS = 50
export const TERMINAL_PRE_SIGNAL_SNAPSHOT_MS = 50
export const TERMINAL_TTY_CLOSE_CONFIRM_MS = 25
export const TERMINAL_TTY_SIGNAL_RETRY_MS = 50

export interface ExitObservation {
  readonly whenExited: Promise<void>
  exitCode: number | null
}

interface TerminalExitProof {
  readonly platform: NodeJS.Platform
  readonly rootExited: boolean
  readonly processSnapshotReliable: boolean
  readonly descendantsExited: boolean
}

export function terminalExitProofIsComplete(proof: TerminalExitProof) {
  if (proof.platform === 'win32') {
    // Descriptor close only requests handle-owned Job termination. The
    // separate native process-tree event fires after Job accounting reaches
    // zero and the final Job handle closes; public onExit remains later so it
    // can preserve buffered output and resource cleanup ordering.
    return proof.rootExited
  }
  return proof.rootExited && proof.processSnapshotReliable && proof.descendantsExited
}

function isMissingProcessError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

function isMissingTtyError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export function signalTree(
  live: LiveTerminalProcess,
  _processPids: readonly number[],
  _force: boolean,
) {
  // Never use node-pty's public kill(): POSIX implements it with a stored
  // numeric PID, and Windows process snapshots are not ownership handles.
  return forceClosePty(live)
}

export async function forceValidatedTree(
  live: LiveTerminalProcess,
  processIdentities: readonly TerminalProcessIdentity[],
  state: ExitObservation,
  rootSignalVerified: boolean,
  deadline: number,
) {
  if (process.platform === 'win32') {
    // The patched Windows backend owns the tree by Job handle.
    return
  }
  // Signal only through the native identity-bound primitive. Linux uses a
  // retained pidfd and Darwin uses an audit token containing the current
  // pid-version. Descendants go first; a still-live, freshly verified root is
  // last so its exit cannot erase an ancestry edge before child cleanup.
  const descendants = processIdentities.filter(({ pid }) => pid !== live.pid).toReversed()
  for (const identity of descendants) {
    if (Date.now() >= deadline) return
    signalTerminalProcessIdentity(identity, FORCE_SIGNAL)
  }
  if (
    Date.now() < deadline &&
    state.exitCode === null &&
    rootSignalVerified &&
    live.processIdentity !== null
  ) {
    signalTerminalProcessIdentity(live.processIdentity, FORCE_SIGNAL)
  }
}

/**
 * Close node-pty's master descriptor on the forced pass. POSIX hangup semantics
 * then reach tty-attached jobs without relying on a delayed userspace process
 * table. Detached jobs remain covered by the separately validated pid set.
 *
 * Do not call UnixTerminal.destroy(). node-pty 1.1.0 implements that public
 * method by closing `_socket` and then calling kill('SIGHUP') with the stored
 * numeric PID. A recycled root PID would therefore bypass our birth-identity
 * proof. Our patched POSIX close also disposes the raw-FD writer before the
 * socket releases its descriptor, preventing a queued write from reaching a
 * reused FD. If that method is absent, fail closed without signaling anything.
 */
export function forceClosePty(live: LiveTerminalProcess) {
  const close: unknown = Reflect.get(live.pty, 'closeDescriptor')
  if (typeof close !== 'function') return false
  try {
    Reflect.apply(close, live.pty, [])
    return true
  } catch (error) {
    logger.warn('Terminal PTY descriptor close failed', {
      pid: live.pid,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isMissingProcessError(error)
  }
}

export function descendantsExited(
  rootPid: number,
  processPids: readonly number[],
  zombiePids: readonly number[],
) {
  const zombies = new Set(zombiePids)
  return processPids.every((pid) => pid === rootPid || zombies.has(pid) || !isPidAlive(pid))
}

export async function refreshAndConfirmExit(
  state: ExitObservation,
  rootPid: number,
  cachedPids: readonly number[],
  cachedIdentities: readonly TerminalProcessIdentity[],
  tty: string | null,
  ttyIdentity: string | null,
  ttyClosed: boolean,
  ptyCloseRequested: boolean,
  timeoutMs: number,
) {
  if (process.platform === 'win32') {
    const confirmed = terminalExitProofIsComplete({
      platform: process.platform,
      rootExited: state.exitCode !== null,
      processSnapshotReliable: false,
      descendantsExited: false,
    })
    return {
      confirmed,
      processPids: [...new Set([rootPid, ...cachedPids])],
      processIdentities: cachedIdentities,
      ttyProcessPids: [],
      unverifiedProcessPids: state.exitCode !== null ? [] : cachedPids,
      zombiePids: [],
      observedProcesses: [],
      reliable: state.exitCode !== null,
      rootIdentityVerified: true,
      rootIdentityMismatch: false,
      rootExitedByIdentity: state.exitCode !== null,
    }
  }
  if (timeoutMs <= 0) {
    return {
      confirmed: false,
      processPids: [...new Set([rootPid, ...cachedPids])],
      processIdentities: cachedIdentities,
      ttyProcessPids: [],
      unverifiedProcessPids: cachedPids,
      zombiePids: [],
      observedProcesses: [],
      reliable: false,
      rootIdentityVerified: false,
      rootIdentityMismatch: false,
      rootExitedByIdentity: false,
    }
  }
  const refreshed = await refreshTerminalProcessPids(
    rootPid,
    cachedPids,
    cachedIdentities,
    tty,
    ttyIdentity,
    ttyClosed,
    timeoutMs,
    ttyClosed || ptyCloseRequested,
  )
  return {
    confirmed: terminalExitProofIsComplete({
      platform: process.platform,
      rootExited: state.exitCode !== null || refreshed.rootExitedByIdentity,
      processSnapshotReliable: refreshed.reliable,
      descendantsExited: descendantsExited(rootPid, refreshed.processPids, refreshed.zombiePids),
    }),
    processPids: refreshed.processPids,
    processIdentities: refreshed.processIdentities,
    ttyProcessPids: refreshed.ttyProcessPids,
    unverifiedProcessPids: refreshed.unverifiedProcessPids,
    zombiePids: refreshed.zombiePids,
    observedProcesses: refreshed.observedProcesses,
    reliable: refreshed.reliable,
    rootIdentityVerified: refreshed.rootIdentityVerified,
    rootIdentityMismatch: refreshed.rootIdentityMismatch,
    rootExitedByIdentity: refreshed.rootExitedByIdentity,
  }
}

export function remainingSnapshotBudget(
  deadline: number,
  maximumMs = TERMINAL_PROCESS_SNAPSHOT_MS,
) {
  return Math.max(0, Math.min(maximumMs, deadline - Date.now()))
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export async function waitForRootExit(state: ExitObservation, deadline: number) {
  while (state.exitCode === null) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await Promise.race([state.whenExited, delay(Math.min(EXIT_POLL_MS, remaining))])
  }
  return true
}

export async function terminalTtyIsClosed(tty: string | null) {
  if (process.platform === 'win32' || tty === null) return false
  try {
    await access(`/dev/${tty}`)
    return false
  } catch (error) {
    return isMissingTtyError(error)
  }
}

/** Give node-pty's asynchronous descriptor close one bounded turn to release devfs. */
export async function waitForTerminalTtyClose(tty: string | null, deadline: number) {
  if (process.platform === 'win32' || tty === null) return false
  while (true) {
    if (await terminalTtyIsClosed(tty)) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await delay(Math.min(EXIT_POLL_MS, remaining))
  }
}

export async function confirmTerminalTtyClosed(
  tty: string | null,
  closeRequested: boolean,
  deadline: number,
) {
  if (
    closeRequested &&
    (await waitForTerminalTtyClose(
      tty,
      Math.min(deadline, Date.now() + TERMINAL_TTY_CLOSE_CONFIRM_MS),
    ))
  ) {
    return true
  }
  return terminalTtyIsClosed(tty)
}

export async function waitForExit(
  state: ExitObservation,
  rootPid: number,
  processPids: readonly number[],
  zombiePids: readonly number[],
  deadline: number,
) {
  while (true) {
    if (state.exitCode !== null && descendantsExited(rootPid, processPids, zombiePids)) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return state.exitCode !== null && descendantsExited(rootPid, processPids, zombiePids)
    }
    if (state.exitCode === null) {
      await Promise.race([state.whenExited, delay(Math.min(EXIT_POLL_MS, remaining))])
    } else {
      await delay(Math.min(EXIT_POLL_MS, remaining))
    }
  }
}

export function observeExit(pty: IPty) {
  let resolveExit: () => void = () => undefined
  const state: ExitObservation = {
    whenExited: new Promise<void>((resolve) => {
      resolveExit = resolve
    }),
    exitCode: null,
  }
  const subscription = pty.onExit(({ exitCode }) => {
    if (state.exitCode !== null) return
    state.exitCode = normalizeTerminalExitCode(exitCode)
    resolveExit()
  })
  return { state, dispose: () => subscription.dispose() }
}
