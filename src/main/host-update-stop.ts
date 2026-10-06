import { openSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { ReadStream, WriteStream } from 'node:tty'
import { app } from 'electron'
import { isDesktopAppRunning } from './desktop-instance-probe'
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

export type UpdateRunChoice = 'when-idle' | 'now' | 'cancel'

export type HostUpdateStopState =
  | Exclude<SessionHostReleaseOutcome, 'stop-requested'>
  | 'cancelled'
  | 'desktop-open'

export interface HostUpdateStopReport {
  readonly state: HostUpdateStopState
  /** Agent Runs that were active when the update started. */
  readonly activeRuns: number
}

export interface HostUpdateStopDependencies {
  /** The desktop app owns its Host while it is open; quit it first (the install script does). */
  readonly desktopAppRunning: () => boolean
  /** Active agent Runs, or `null` when no Session Host is running. Never starts a Host. */
  readonly countActiveRuns: () => Promise<number | null>
  readonly chooseRunHandling: (activeRuns: number) => Promise<UpdateRunChoice>
  readonly release: () => Promise<SessionHostReleaseOutcome>
  readonly progress: (text: string) => void
  readonly wait: (milliseconds: number) => Promise<void>
}

/** Like the desktop app's Restart when idle: poll, and count Runs started meanwhile. */
const RUN_POLL_INTERVAL_MS = 3_000

const RUN_PROMPT_ANSWERS: Readonly<Record<string, UpdateRunChoice>> = {
  '': 'when-idle',
  w: 'when-idle',
  n: 'now',
  c: 'cancel',
}

function runsNoun(activeRuns: number) {
  return activeRuns === 1 ? '1 agent run' : `${activeRuns} agent runs`
}

function runsPhrase(activeRuns: number) {
  return `${runsNoun(activeRuns)} ${activeRuns === 1 ? 'is' : 'are'}`
}

/**
 * Asks on the terminal itself, not stdin: `curl … | bash` gives the installer the script as its
 * stdin. Without a terminal it waits for the Runs, as Restart when idle does by default.
 */
export async function askRunHandlingOnTerminal(activeRuns: number): Promise<UpdateRunChoice> {
  const question = `${runsPhrase(activeRuns)} still working. Wait until they finish [W], stop them now [n], or cancel [c]? `
  const terminal = process.stdin.isTTY
    ? { input: process.stdin, output: process.stderr, close: () => undefined }
    : openTerminal()
  if (!terminal) {
    process.stderr.write(
      `${runsPhrase(activeRuns)} still working; waiting for them to finish (Ctrl-C cancels).\n`,
    )
    return 'when-idle'
  }
  const prompt = createInterface({ input: terminal.input, output: terminal.output })
  // Ctrl-C or Ctrl-D at the question cancels the update, as it would cancel the installer.
  const aborted = new AbortController()
  prompt.once('SIGINT', () => aborted.abort())
  try {
    while (true) {
      const answer = await prompt.question(question, { signal: aborted.signal }).catch(() => 'c')
      const choice = RUN_PROMPT_ANSWERS[answer.trim().toLowerCase().slice(0, 1)]
      if (choice) return choice
    }
  } finally {
    prompt.close()
    terminal.close()
  }
}

/** The controlling terminal as TTY streams, which close cleanly unlike a file read of /dev/tty. */
function openTerminal() {
  if (process.platform === 'win32') return null
  try {
    const input = new ReadStream(openSync('/dev/tty', 'r'))
    const output = new WriteStream(openSync('/dev/tty', 'w'))
    return {
      input,
      output,
      close: () => {
        input.destroy()
        output.destroy()
      },
    }
  } catch {
    return null
  }
}

export async function stopSessionHostForUpdate(
  dependencies: HostUpdateStopDependencies,
): Promise<HostUpdateStopReport> {
  if (dependencies.desktopAppRunning()) return { state: 'desktop-open', activeRuns: 0 }
  const activeRuns = await dependencies.countActiveRuns()
  if (activeRuns === null) return { state: 'not-running', activeRuns: 0 }
  if (activeRuns > 0) {
    const choice = await dependencies.chooseRunHandling(activeRuns)
    if (choice === 'cancel') return { state: 'cancelled', activeRuns }
    if (choice === 'when-idle') {
      let remaining: number | null = activeRuns
      let reported = -1
      while (remaining !== null && remaining > 0) {
        if (remaining !== reported) {
          dependencies.progress(`Waiting for ${runsNoun(remaining)} to finish…`)
          reported = remaining
        }
        await dependencies.wait(RUN_POLL_INTERVAL_MS)
        remaining = await dependencies.countActiveRuns()
      }
      if (remaining === null) return { state: 'not-running', activeRuns }
    }
    // Stop them now: the Host's update deadline interrupts Runs still active, recorded as such.
  }
  const outcome = await dependencies.release()
  return { state: outcome === 'stop-requested' ? 'stopped' : outcome, activeRuns }
}

const HOST_UPDATE_STOP_MESSAGES: Readonly<Record<HostUpdateStopState, string>> = {
  'not-running': 'Session Host is not running.',
  stopped: 'Session Host stopped for the update.',
  replaced: 'Session Host stopped; another client has already started a new one.',
  refused: 'The Session Host did not accept the update stop; it keeps running.',
  'timed-out': 'Session Host is still stopping; restart OpenWaggle after the update.',
  cancelled: 'Update cancelled; the Session Host keeps running.',
  'desktop-open': 'OpenWaggle is open, so it keeps its Session Host. Quit OpenWaggle to stop it.',
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
      if ((await probeRunningHost(client, status.probe)).state === 'not-running') return null
      // One Session counts once, as in the desktop app.
      return new Set((await status.snapshotActiveRuns(client)).map((run) => run.sessionId)).size
    },
    chooseRunHandling: askRunHandlingOnTerminal,
    release: () => releaseSessionHostForUpdate(client, { waitForExit: true }),
    progress: (text) => process.stderr.write(`${text}\n`),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }
}
