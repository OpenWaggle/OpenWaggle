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
  TerminalRecord,
  TerminalTerminationState,
} from './terminal-records'
import { pauseOutputForShutdown, restoreOutputFlow } from './terminal-shutdown-output-flow'
import {
  retryLiveTerminalTtySignal,
  signalLiveTerminalTtyMembers,
  terminalTtySignalResolvedRoot,
} from './terminal-tty-signal'

const logger = createLogger('terminal-process-shutdown')
const FORCED_TERMINATION_EXIT_CODE = -1

type RefreshedExit = Awaited<ReturnType<typeof refreshAndConfirmExit>>

interface ShutdownContext {
  readonly record: TerminalRecord
  readonly live: LiveTerminalProcess
  readonly state: TerminalTerminationState
  readonly onLivePidsChanged: () => void
  readonly cachedPids: readonly number[]
  readonly cachedIdentities: readonly TerminalProcessIdentity[]
  readonly tty: string | null
}

interface PendingGracefulShutdown {
  readonly finished: false
  readonly refreshed: RefreshedExit
  readonly ttyClosed: boolean
  readonly closeRequested: boolean
  readonly gracefulDeadline: number
}

interface PendingForcedShutdown {
  readonly finished: false
  readonly refreshed: RefreshedExit
  readonly ttyClosed: boolean
  readonly closeRequested: boolean
}

function finishConfirmedExit(context: ShutdownContext) {
  const { record, state } = context
  if (record.live?.pty !== state.pty) return
  // Shutdown pauses the readable side while identity snapshots and signals
  // run. Once the owned tree is proven dead, resume the finite kernel/native
  // tail before detaching this generation. This keeps final output lossless
  // and prevents resource drain from depending on a permanently paused
  // stream; late chunks remain accepted through `drainingProcesses` below.
  if (context.live.outputPaused) {
    context.live.resumeOutput()
    context.live.outputPaused = false
  }
  record.spawnGeneration += 1
  record.promptDetector = null
  record.drainingProcesses.add(context.live)
  record.live = null
  // Windows can prove Job termination before node-pty finishes output/HPCON
  // cleanup. A non-null code keeps this record distinct from spawn-in-flight;
  // the private retained target owns the backend until its exit latch resolves.
  record.exitCode = state.exitCode ?? FORCED_TERMINATION_EXIT_CODE
  record.activity = null
  context.onLivePidsChanged()
}

function finishWhenConfirmed(confirmed: boolean, context: ShutdownContext) {
  if (!confirmed) return false
  finishConfirmedExit(context)
  return true
}

function rootSignalIsVerified(refreshed: RefreshedExit) {
  return process.platform === 'win32' || refreshed.rootIdentityVerified
}

function mergeProcessPids(...groups: readonly (readonly number[])[]) {
  return [...new Set(groups.flat())]
}

async function attemptGracefulShutdown(
  context: ShutdownContext,
): Promise<{ readonly finished: true } | PendingGracefulShutdown> {
  const gracefulDeadline = Date.now() + TERMINAL_GRACEFUL_SHUTDOWN_MS
  const snapshotBudget = remainingSnapshotBudget(gracefulDeadline, TERMINAL_PRE_SIGNAL_SNAPSHOT_MS)
  const preflightPromise = refreshAndConfirmExit(
    context.state,
    context.live.pid,
    context.cachedPids,
    context.cachedIdentities,
    context.tty,
    context.live.ttyIdentity,
    false,
    false,
    snapshotBudget,
  )
  const ttySignalResult = signalLiveTerminalTtyMembers(context.live, false)
  const preflight = await preflightPromise
  let closeRequested = false
  if (!terminalTtySignalResolvedRoot(ttySignalResult)) {
    const rootVerified = rootSignalIsVerified(preflight)
    if (context.state.exitCode === null && rootVerified) {
      closeRequested = signalTree(context.live, [context.live.pid], false)
    }
    if (
      context.state.exitCode === null &&
      !rootVerified &&
      context.live.signalTtyMembers === undefined
    ) {
      closeRequested = forceClosePty(context.live)
    }
  }
  if (process.platform !== 'win32' || !closeRequested) {
    await waitForRootExit(context.state, gracefulDeadline)
  }
  const ttyClosed = await terminalTtyIsClosed(context.tty)
  const knownPids = mergeProcessPids(
    context.cachedPids,
    preflight.processPids,
    preflight.unverifiedProcessPids,
  )
  const knownIdentities = mergeTerminalProcessIdentities(
    context.cachedIdentities,
    preflight.processIdentities,
  )
  const refreshed = await refreshAndConfirmExit(
    context.state,
    context.live.pid,
    knownPids,
    knownIdentities,
    context.tty,
    context.live.ttyIdentity,
    ttyClosed,
    closeRequested,
    remainingSnapshotBudget(gracefulDeadline),
  )
  if (finishWhenConfirmed(refreshed.confirmed, context)) return { finished: true }
  return { finished: false, refreshed, ttyClosed, closeRequested, gracefulDeadline }
}

async function attemptForcedShutdown(
  context: ShutdownContext,
  graceful: PendingGracefulShutdown,
): Promise<{ readonly finished: true } | PendingForcedShutdown> {
  const forceDeadline = graceful.gracefulDeadline + TERMINAL_FORCE_SHUTDOWN_MS
  const ttySignalResult = await retryLiveTerminalTtySignal(
    context.live,
    true,
    Math.min(
      forceDeadline - TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS,
      Date.now() + TERMINAL_TTY_SIGNAL_RETRY_MS,
    ),
  )
  const nativeResolvedRoot = terminalTtySignalResolvedRoot(ttySignalResult)
  const forceActionDeadline = forceDeadline - TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS
  const validatedPids = graceful.refreshed.processPids
  const validatedIdentities = graceful.refreshed.processIdentities
  // The native descriptor-bound sweep reports only an aggregate count, not
  // exact identities. A process observed on the tty may have detached before
  // that sweep, so every known descendant still needs a fresh birth check.
  if (validatedIdentities.length > 0) {
    await forceValidatedTree(
      context.live,
      validatedIdentities,
      context.state,
      !nativeResolvedRoot && rootSignalIsVerified(graceful.refreshed),
      forceActionDeadline,
    )
  }
  const closeRequested = graceful.closeRequested || forceClosePty(context.live)
  const knownPids = mergeProcessPids(
    context.cachedPids,
    validatedPids,
    graceful.refreshed.unverifiedProcessPids,
  )
  const knownIdentities = mergeTerminalProcessIdentities(
    context.cachedIdentities,
    validatedIdentities,
  )
  const ttyClosed =
    graceful.ttyClosed ||
    (await confirmTerminalTtyClosed(context.tty, closeRequested, forceDeadline))
  const forceRefreshed = await refreshAndConfirmExit(
    context.state,
    context.live.pid,
    knownPids,
    knownIdentities,
    context.tty,
    context.live.ttyIdentity,
    ttyClosed,
    closeRequested,
    remainingSnapshotBudget(forceDeadline, TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS),
  )
  if (finishWhenConfirmed(forceRefreshed.confirmed, context)) return { finished: true }

  await forceValidatedTree(
    context.live,
    forceRefreshed.processIdentities,
    context.state,
    !nativeResolvedRoot && rootSignalIsVerified(forceRefreshed),
    forceActionDeadline,
  )

  const finalSnapshotBudget = remainingSnapshotBudget(
    forceDeadline,
    TERMINAL_FORCE_CONFIRM_SNAPSHOT_MS,
  )
  const waitPids = forceRefreshed.processPids
  const waitZombiePids = forceRefreshed.zombiePids
  await waitForExit(
    context.state,
    context.live.pid,
    waitPids,
    waitZombiePids,
    Math.max(Date.now(), forceDeadline - finalSnapshotBudget),
  )
  const finalKnownPids = mergeProcessPids(
    knownPids,
    forceRefreshed.processPids,
    forceRefreshed.unverifiedProcessPids,
  )
  const finalKnownIdentities = mergeTerminalProcessIdentities(
    knownIdentities,
    forceRefreshed.processIdentities,
  )
  const refreshed = await refreshAndConfirmExit(
    context.state,
    context.live.pid,
    finalKnownPids,
    finalKnownIdentities,
    context.tty,
    context.live.ttyIdentity,
    ttyClosed,
    closeRequested,
    remainingSnapshotBudget(forceDeadline),
  )
  if (finishWhenConfirmed(refreshed.confirmed, context)) return { finished: true }
  return { finished: false, refreshed, ttyClosed, closeRequested }
}

function reportUnconfirmedExit(context: ShutdownContext, forced: PendingForcedShutdown) {
  logger.error('Terminal process tree did not confirm exit after forced shutdown', {
    pid: context.live.pid,
    descendantPids: forced.refreshed.processPids.filter((pid) => pid !== context.live.pid),
    unverifiedProcessPids: forced.refreshed.unverifiedProcessPids,
    zombiePids: forced.refreshed.zombiePids,
    rootExitObserved: context.state.exitCode !== null,
    processSnapshotReliable: forced.refreshed.reliable,
    rootIdentityMismatch: forced.refreshed.rootIdentityMismatch,
    tty: context.tty,
    ptyCloseRequested: forced.closeRequested,
    observedProcesses: forced.refreshed.observedProcesses,
  })
  if (context.record.live?.pty === context.state.pty && context.state.exitCode !== null) {
    context.record.exitCode = context.state.exitCode
  }
}

export async function performShutdown(
  record: TerminalRecord,
  live: LiveTerminalProcess,
  state: TerminalTerminationState,
  onLivePidsChanged: () => void,
) {
  // Quiesce reads so a flood cannot starve the bounded safety snapshots.
  const wasPaused = pauseOutputForShutdown(live)
  await settleLiveProcessMetadata(live)
  const activity = record.activity
  const rootIdentities = live.processIdentity === null ? [] : [live.processIdentity]
  // Only the spawn-time identity authorizes root signals; inspector identities remain child-only.
  const activityIdentities = (activity?.processIdentities ?? []).filter(
    (identity) => identity.pid !== live.pid,
  )
  const context: ShutdownContext = {
    record,
    live,
    state,
    onLivePidsChanged,
    cachedPids: activity?.processPids ?? [],
    cachedIdentities: mergeTerminalProcessIdentities(activityIdentities, rootIdentities),
    tty: live.tty ?? activity?.tty ?? null,
  }
  const graceful = await attemptGracefulShutdown(context)
  if (graceful.finished) return true
  const forced = await attemptForcedShutdown(context, graceful)
  if (forced.finished) return true
  restoreOutputFlow(record, wasPaused)
  reportUnconfirmedExit(context, forced)
  return false
}
