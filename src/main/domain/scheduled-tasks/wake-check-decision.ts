import { type HeartbeatWakeCheckReport, wakeCheckSeconds } from './heartbeat-run-context'

/** What a Wake check printed and how it ended (#388). */
export interface WakeCheckExecution {
  readonly exitCode: number | null
  /** The signal that ended it, when one did. */
  readonly signal: string | null
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
  /** Set when the command could not be started at all. */
  readonly startError?: string
}

export interface WakeCheckRequest {
  readonly command: string
  readonly workingPath: string
  readonly projectPath: string | null
}

/** Exit codes a POSIX shell uses when the command itself could not run: not executable, not found. */
const SHELL_CANNOT_RUN_EXIT_CODES: ReadonlySet<number> = new Set([126, 127])
const RUN_MESSAGE_LIMIT = 500

export type WakeCheckDecision =
  | { readonly kind: 'idle' }
  | { readonly kind: 'woke'; readonly report: HeartbeatWakeCheckReport; readonly message: string }
  | { readonly kind: 'failed'; readonly report: HeartbeatWakeCheckReport; readonly message: string }

function bounded(text: string) {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > RUN_MESSAGE_LIMIT ? `${flat.slice(0, RUN_MESSAGE_LIMIT - 1)}…` : flat
}

function failureOf(execution: WakeCheckExecution, timeoutMs: number) {
  if (execution.startError) return `could not start: ${execution.startError}`
  if (execution.timedOut) return `timed out after ${String(wakeCheckSeconds(timeoutMs))} s`
  if (execution.signal) return `was stopped by ${execution.signal}`
  if (execution.exitCode === null) return 'ended without an exit code'
  if (SHELL_CANNOT_RUN_EXIT_CODES.has(execution.exitCode)) {
    return `could not run its command (exit ${String(execution.exitCode)})`
  }
  return null
}

/**
 * What a Wake check means for its firing (#388): nothing to do when it exits 0 and prints nothing
 * on standard output; wake otherwise. It failed, and is never read as nothing to do, when it could
 * not start, timed out, was killed by a signal, or the shell could not run its command (126/127).
 */
export function decideWakeCheck(
  command: string,
  execution: WakeCheckExecution,
  timeoutMs: number,
): WakeCheckDecision {
  const failure = failureOf(execution, timeoutMs)
  const base = {
    command,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    stdout: execution.stdout,
    stderr: execution.stderr,
    truncated: execution.truncated,
  }
  if (failure) {
    const detail = execution.stderr.trim() || execution.stdout.trim()
    return {
      kind: 'failed',
      report: { ...base, result: 'failed', failure },
      message: bounded(`The Wake check ${failure}${detail ? `: ${detail}` : '.'}`),
    }
  }
  if (execution.exitCode === 0 && execution.stdout.trim() === '') return { kind: 'idle' }
  const printed = execution.stdout.trim()
  const exited = execution.exitCode === 0 ? '' : ` exited ${String(execution.exitCode)}`
  return {
    kind: 'woke',
    report: { ...base, result: 'woke' },
    message: bounded(`The Wake check${exited}${printed ? `: ${printed}` : '.'}`),
  }
}
