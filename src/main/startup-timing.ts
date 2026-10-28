/**
 * Startup timing marks for the GUI and the Session Host (`--openwaggle-startup-timings`).
 *
 * Each mark logs how long after this module loaded it happened (`elapsedMs`) and how long after
 * the process started (uptime, in the message), so a measurement can line up the GUI's and the
 * Host's marks on one wall clock. Off unless the switch, or the variable the GUI passes to the
 * Host it launches, is set.
 */
import { app } from 'electron'
import { readEnvironmentVariables } from './env'
import { createLogger } from './logger'
import {
  STARTUP_TIMINGS_ENVIRONMENT_VARIABLE,
  startupTimingsRequestedBy,
} from './session-host/session-host-launch-command'

const STARTUP_TIMING_PRECISION = 1
const MILLISECONDS_PER_SECOND = 1_000
const moduleLoadedAt = performance.now()

export type StartupMark = (label: string) => void

export function startupTimingsRequested() {
  return startupTimingsRequestedBy({
    environment: readEnvironmentVariables([STARTUP_TIMINGS_ENVIRONMENT_VARIABLE]),
    commandLine: app.commandLine,
  })
}

function rounded(milliseconds: number) {
  return Number(milliseconds.toFixed(STARTUP_TIMING_PRECISION))
}

export function createStartupMark(namespace: string): StartupMark {
  const logger = createLogger(namespace)
  let enabled: boolean | undefined
  return (label) => {
    try {
      enabled ??= startupTimingsRequested()
    } catch {
      // A mark never fails the startup it measures.
      enabled = false
    }
    if (!enabled) return
    // The uptime rides in the message: the data stays two short fields on one console line,
    // which the startup measurement harnesses parse.
    logger.info(
      `Startup timing at ${String(rounded(process.uptime() * MILLISECONDS_PER_SECOND))} ms uptime`,
      { label, elapsedMs: rounded(performance.now() - moduleLoadedAt) },
    )
  }
}
