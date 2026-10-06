import { app } from 'electron'
import { isDesktopAppRunning } from './desktop-instance-probe'
import {
  askRunHandling,
  openPromptTerminal,
  runsNoun,
  type UpdateRunChoice,
} from './host-update-prompt'
import type { LocalSessionCliClientInput } from './local-session-cli-client'
import {
  releaseSessionHostForUpdate,
  type SessionHostReleaseOutcome,
} from './session-host/session-host-update-release'
import { defaultStatusCliDependencies, probeRunningHost } from './status-cli'

/**
 * Stopping the Session Host before `openwaggle update` or the install script replaces the app,
 * with the same rules as Restart to update in the desktop app (ADR 0047): an update never
 * interrupts an agent Run without asking, and the old version's Host never outlives the install.
 */

export type { UpdateRunChoice } from './host-update-prompt'

export type HostUpdateStopState =
  | Exclude<SessionHostReleaseOutcome, 'stop-requested'>
  | 'cancelled'
  | 'desktop-open'

export interface HostUpdateStopReport {
  readonly state: HostUpdateStopState
  /** Agent Runs that were active when the update started. */
  readonly activeRuns: number
}

export interface HostRuns {
  readonly activeRuns: number
  /** An older Host handing over to this version, which only exits once its Runs end. */
  readonly handingOver: boolean
}

export interface HostUpdateStopDependencies {
  /** The desktop app owns its Host while it is open; quit it first (the install script does). */
  readonly desktopAppRunning: () => boolean
  /** The Host's active agent Runs, or `null` when none is running. Never starts a Host. */
  readonly countActiveRuns: () => Promise<HostRuns | null>
  readonly chooseRunHandling: (activeRuns: number) => Promise<UpdateRunChoice>
  readonly release: () => Promise<SessionHostReleaseOutcome>
  readonly progress: (text: string) => void
  readonly wait: (milliseconds: number) => Promise<void>
}

/** Like the desktop app's Restart when idle: poll, and count Runs started meanwhile. */
const RUN_POLL_INTERVAL_MS = 3_000
/** The shell's status for a command ended by Ctrl-C (128 + SIGINT). */
const INTERRUPTED_EXIT_CODE = 130

/**
 * Ctrl-C, closing the terminal or SIGTERM quits Electron gracefully with status 0, which would
 * read as a finished stop and let an installer go on. While the Host stops, they cancel the update.
 */
export async function cancelUpdateOnInterrupt<T>(task: () => Promise<T>): Promise<T> {
  const cancel = () => {
    process.stderr.write('\nUpdate cancelled. OpenWaggle was not updated.\n')
    app.exit(INTERRUPTED_EXIT_CODE)
  }
  app.once('before-quit', cancel)
  try {
    return await task()
  } finally {
    app.off('before-quit', cancel)
  }
}

/** Wait until no Run is active; `false` when the Host exited meanwhile. */
async function waitForRuns(dependencies: HostUpdateStopDependencies, activeRuns: number) {
  let remaining = activeRuns
  let reported = -1
  while (remaining > 0) {
    if (remaining !== reported) {
      dependencies.progress(`Waiting for ${runsNoun(remaining)} to finish…`)
      reported = remaining
    }
    await dependencies.wait(RUN_POLL_INTERVAL_MS)
    const host = await dependencies.countActiveRuns()
    if (!host) return false
    remaining = host.activeRuns
  }
  return true
}

/** Settle the Host's active Runs as the user chooses, then stop it. */
async function settleRunsAndRelease(
  dependencies: HostUpdateStopDependencies,
): Promise<HostUpdateStopReport> {
  if (dependencies.desktopAppRunning()) return { state: 'desktop-open', activeRuns: 0 }
  const host = await dependencies.countActiveRuns()
  if (!host) return { state: 'not-running', activeRuns: 0 }
  const { activeRuns } = host
  if (activeRuns > 0) {
    // An older Host cannot be told to stop its Runs; it hands over once they end.
    const choice = host.handingOver ? 'when-idle' : await dependencies.chooseRunHandling(activeRuns)
    if (choice === 'cancel') return { state: 'cancelled', activeRuns }
    if (choice === 'when-idle' && !(await waitForRuns(dependencies, activeRuns))) {
      return { state: 'not-running', activeRuns }
    }
    // Stop them now: the Host's update deadline interrupts Runs still active, recorded as such.
  }
  // The wait can be long, and the user may have opened the app meanwhile to watch the Runs.
  if (dependencies.desktopAppRunning()) return { state: 'desktop-open', activeRuns }
  const outcome = await dependencies.release()
  return { state: outcome === 'stop-requested' ? 'stopped' : outcome, activeRuns }
}

/** A Host that another client, such as `openwaggle mcp serve`, started again is stopped once more. */
const RELEASE_ATTEMPTS = 2

export async function stopSessionHostForUpdate(
  dependencies: HostUpdateStopDependencies,
): Promise<HostUpdateStopReport> {
  let report = await settleRunsAndRelease(dependencies)
  for (let attempt = 1; attempt < RELEASE_ATTEMPTS && report.state === 'replaced'; attempt++) {
    // The new Host may have Runs of its own; they are asked about like the first Host's.
    const again = await settleRunsAndRelease(dependencies)
    report = { ...again, activeRuns: Math.max(report.activeRuns, again.activeRuns) }
  }
  return report
}

const HOST_UPDATE_STOP_MESSAGES: Readonly<Record<HostUpdateStopState, string>> = {
  'not-running': 'Session Host is not running.',
  stopped: 'Session Host stopped for the update.',
  replaced:
    'Another OpenWaggle process, such as `openwaggle mcp serve`, keeps starting a Session Host. Close it and try again.',
  refused: 'The Session Host did not accept the update stop; it keeps running.',
  'timed-out': 'Session Host is still stopping; restart OpenWaggle after the update.',
  cancelled: 'Update cancelled; the Session Host keeps running.',
  'desktop-open':
    'OpenWaggle is open, so it keeps its Session Host. Quit OpenWaggle, then run `openwaggle host stop --update`.',
}

export function formatHostUpdateStopReport(report: HostUpdateStopReport) {
  return HOST_UPDATE_STOP_MESSAGES[report.state]
}

/** The real dependencies of `openwaggle host stop --update`, for a prepared CLI client. */
export function defaultCliHostUpdateStopDependencies(
  client: LocalSessionCliClientInput,
): HostUpdateStopDependencies {
  const status = defaultStatusCliDependencies
  return {
    desktopAppRunning: () => isDesktopAppRunning(app),
    countActiveRuns: async () => {
      const host = await probeRunningHost(client, status.probe)
      if (host.state === 'not-running') return null
      // An older Host hands over once its Runs end and answers nothing else meanwhile.
      if (host.state === 'upgrade-pending') {
        return { activeRuns: host.blockingRuns, handingOver: true }
      }
      // One Session counts once, as in the desktop app.
      const runs = await status.snapshotActiveRuns(client)
      return { activeRuns: new Set(runs.map((run) => run.sessionId)).size, handingOver: false }
    },
    chooseRunHandling: (activeRuns) =>
      askRunHandling(activeRuns, openPromptTerminal(), (text) => process.stderr.write(`${text}\n`)),
    release: () => releaseSessionHostForUpdate(client, { waitForExit: true }),
    progress: (text) => process.stderr.write(`${text}\n`),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }
}
