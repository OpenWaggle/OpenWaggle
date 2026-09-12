import { createLogger } from '../../logger'
import {
  confirmTerminalTtyClosed,
  forceClosePty,
  forceValidatedTree,
  refreshAndConfirmExit,
  remainingSnapshotBudget,
  settleLiveProcessMetadata,
  signalTree,
  TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS,
  TERMINAL_FORCE_SHUTDOWN_MS,
  TERMINAL_GRACEFUL_SHUTDOWN_MS,
  TERMINAL_PRE_SIGNAL_SNAPSHOT_MS,
  TERMINAL_TTY_SIGNAL_RETRY_MS,
  terminalTtyIsClosed,
  waitForExit,
  waitForRootExit,
} from './terminal-process-control'
import {
  mergeTerminalProcessIdentities,
  type TerminalProcessIdentity,
} from './terminal-process-identity'
import type {
  LiveTerminalProcess,
  RetainedTerminalProcess,
  TerminalProcessExitObservation,
} from './terminal-records'
import {
  retryLiveTerminalTtySignal,
  signalLiveTerminalTtyMembers,
  terminalTtySignalResolvedRoot,
} from './terminal-tty-signal'

const logger = createLogger('terminal-process-shutdown')

type RefreshedExit = Awaited<ReturnType<typeof refreshAndConfirmExit>>

interface PendingDetachedGracefulShutdown {
  readonly finished: false
  readonly closeRequested: boolean
  readonly ttyClosed: boolean
  readonly knownPids: readonly number[]
  readonly knownIdentities: readonly TerminalProcessIdentity[]
  readonly refreshed: RefreshedExit
  readonly gracefulDeadline: number
}

function pauseOutputForShutdown(live: LiveTerminalProcess) {
  const wasPaused = live.outputPaused
  if (!wasPaused) {
    live.pauseOutput()
    live.outputPaused = true
  }
  return wasPaused
}

function restoreOutputFlow(live: LiveTerminalProcess, wasPaused: boolean) {
  if (live.outputPaused === wasPaused) return
  if (wasPaused) live.pauseOutput()
  else live.resumeOutput()
  live.outputPaused = wasPaused
}

function resumeFiniteOutputTail(live: LiveTerminalProcess) {
  if (!live.outputPaused) return
  live.resumeOutput()
  live.outputPaused = false
}

function rootSignalIsVerified(refreshed: RefreshedExit) {
  return process.platform === 'win32' || refreshed.rootIdentityVerified
}

function mergeProcessPids(...groups: readonly (readonly number[])[]) {
  return [...new Set(groups.flat())]
}

function signalGracefulFallback(
  live: LiveTerminalProcess,
  state: TerminalProcessExitObservation,
  preflight: RefreshedExit,
) {
  if (state.exitCode !== null) return false
  const rootVerified = rootSignalIsVerified(preflight)
  if (rootVerified) return signalTree(live, [live.pid], false)
  if (!rootVerified && live.signalTtyMembers === undefined) return forceClosePty(live)
  return false
}

function forceRemainingIdentities(input: {
  readonly live: LiveTerminalProcess
  readonly state: TerminalProcessExitObservation
  readonly refreshed: RefreshedExit
  readonly nativeResolvedRoot: boolean
  readonly deadline: number
}) {
  return forceValidatedTree(
    input.live,
    input.refreshed.processIdentities,
    input.state,
    !input.nativeResolvedRoot && rootSignalIsVerified(input.refreshed),
    input.deadline,
  )
}

async function attemptDetachedGracefulShutdown(
  target: RetainedTerminalProcess,
  state: TerminalProcessExitObservation,
): Promise<{ readonly finished: true } | PendingDetachedGracefulShutdown> {
  const { live } = target
  await settleLiveProcessMetadata(live)
  target.processPids = mergeProcessPids(target.processPids, [live.pid])
  target.processIdentities = mergeTerminalProcessIdentities(
    target.processIdentities,
    live.processIdentity === null ? [] : [live.processIdentity],
  )
  const gracefulDeadline = Date.now() + TERMINAL_GRACEFUL_SHUTDOWN_MS
  const preflightPromise = refreshAndConfirmExit(
    state,
    live.pid,
    target.processPids,
    target.processIdentities,
    live.tty,
    live.ttyIdentity,
    false,
    false,
    remainingSnapshotBudget(gracefulDeadline, TERMINAL_PRE_SIGNAL_SNAPSHOT_MS),
  )
  const ttySignalResult = signalLiveTerminalTtyMembers(live, false)
  const preflight = await preflightPromise
  retainRefresh(target, preflight)
  const closeRequested = terminalTtySignalResolvedRoot(ttySignalResult)
    ? false
    : signalGracefulFallback(live, state, preflight)
  if (process.platform !== 'win32' || !closeRequested) {
    await waitForRootExit(state, gracefulDeadline)
  }
  const ttyClosed = await terminalTtyIsClosed(live.tty)
  const knownPids = target.processPids
  const knownIdentities = target.processIdentities
  const refreshed = await refreshAndConfirmExit(
    state,
    live.pid,
    knownPids,
    knownIdentities,
    live.tty,
    live.ttyIdentity,
    ttyClosed,
    closeRequested,
    remainingSnapshotBudget(gracefulDeadline),
  )
  retainRefresh(target, refreshed)
  if (retainedShutdownIsComplete(refreshed, state)) return { finished: true }
  return {
    finished: false,
    closeRequested,
    ttyClosed,
    knownPids,
    knownIdentities,
    refreshed,
    gracefulDeadline,
  }
}

function retainedShutdownIsComplete(
  refreshed: RefreshedExit,
  state: TerminalProcessExitObservation,
) {
  return refreshed.confirmed && (process.platform !== 'win32' || state.exitCode !== null)
}

function retainRefresh(target: RetainedTerminalProcess, refreshed: RefreshedExit) {
  const observedPids = mergeProcessPids(refreshed.processPids, refreshed.unverifiedProcessPids, [
    target.live.pid,
  ])
  target.processPids = refreshed.reliable
    ? observedPids
    : mergeProcessPids(target.processPids, observedPids)
  target.processIdentities = mergeTerminalProcessIdentities(
    target.processIdentities,
    refreshed.processIdentities,
  )
}

/** Confirm disposal of a PTY retained after a natural exit or spawn race. */
export async function shutdownDetachedTerminal(target: RetainedTerminalProcess): Promise<boolean> {
  const { live } = target
  const observation = live.processTreeExit
  const wasPaused = pauseOutputForShutdown(live)
  const graceful = await attemptDetachedGracefulShutdown(target, observation)
  if (graceful.finished) {
    resumeFiniteOutputTail(live)
    return true
  }
  const { gracefulDeadline, ttyClosed } = graceful
  let { closeRequested, refreshed } = graceful

  const forceDeadline = gracefulDeadline + TERMINAL_FORCE_SHUTDOWN_MS
  const forcedTtySignalResult = await retryLiveTerminalTtySignal(
    live,
    true,
    Math.min(
      forceDeadline - TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS,
      Date.now() + TERMINAL_TTY_SIGNAL_RETRY_MS,
    ),
  )
  const nativeResolvedRoot = terminalTtySignalResolvedRoot(forcedTtySignalResult)
  const forceActionDeadline = forceDeadline - TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS
  await forceRemainingIdentities({
    live,
    state: observation,
    refreshed,
    nativeResolvedRoot,
    deadline: forceActionDeadline,
  })
  closeRequested = closeRequested || forceClosePty(live)
  const forceClosedTty =
    ttyClosed || (await confirmTerminalTtyClosed(live.tty, closeRequested, forceDeadline))
  refreshed = await refreshAndConfirmExit(
    observation,
    live.pid,
    target.processPids,
    target.processIdentities,
    live.tty,
    live.ttyIdentity,
    forceClosedTty,
    closeRequested,
    remainingSnapshotBudget(forceDeadline, TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS),
  )
  retainRefresh(target, refreshed)
  if (retainedShutdownIsComplete(refreshed, observation)) {
    resumeFiniteOutputTail(live)
    return true
  }

  await forceRemainingIdentities({
    live,
    state: observation,
    refreshed,
    nativeResolvedRoot,
    deadline: forceActionDeadline,
  })

  const finalSnapshotBudget = remainingSnapshotBudget(
    forceDeadline,
    TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS,
  )
  await waitForExit(
    observation,
    live.pid,
    refreshed.processPids,
    refreshed.zombiePids,
    Math.max(Date.now(), forceDeadline - finalSnapshotBudget),
  )
  refreshed = await refreshAndConfirmExit(
    observation,
    live.pid,
    target.processPids,
    target.processIdentities,
    live.tty,
    live.ttyIdentity,
    forceClosedTty,
    closeRequested,
    remainingSnapshotBudget(forceDeadline),
  )
  retainRefresh(target, refreshed)
  if (retainedShutdownIsComplete(refreshed, observation)) {
    resumeFiniteOutputTail(live)
    return true
  }

  restoreOutputFlow(live, wasPaused)
  logger.error('Detached stale PTY did not confirm exit after forced shutdown', {
    pid: live.pid,
    descendantPids: refreshed.processPids.filter((pid) => pid !== live.pid),
    unverifiedProcessPids: refreshed.unverifiedProcessPids,
    zombiePids: refreshed.zombiePids,
    rootExitObserved: observation.exitCode !== null,
    processSnapshotReliable: refreshed.reliable,
    rootIdentityMismatch: refreshed.rootIdentityMismatch,
    tty: live.tty,
    ptyCloseRequested: closeRequested,
    observedProcesses: refreshed.observedProcesses,
  })
  return false
}
