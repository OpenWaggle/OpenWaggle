/** Status report types and their human-readable rendering. */
import { sanitizeTerminalText } from './run-cli-output'

/** A field printed on one line; a line break in a title must not fake another status line. */
function singleLine(text: string) {
  return sanitizeTerminalText(text).replace(/\s*\n\s*/g, ' ')
}

const MILLISECONDS_PER_SECOND = 1_000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

export interface StatusActiveRun {
  readonly sessionId: string
  /** `null` when the Session's status could not be read. */
  readonly runId: string | null
  /** `null` when the Session could not be read; never a guessed value. */
  readonly title: string | null
  readonly projectPath: string | null
  readonly model: string
  readonly startedAt: number
  /** `null` when pending questions could not be listed. */
  readonly pendingQuestions: number | null
}

export type StatusReport =
  | { readonly version: string; readonly host: { readonly state: 'not-running' } }
  | {
      readonly version: string
      readonly host: {
        readonly state: 'upgrade-pending'
        readonly hostInstanceId: string
        readonly blockingRuns: number
      }
    }
  | {
      readonly version: string
      readonly host: {
        readonly state: 'running'
        readonly hostInstanceId: string
        readonly protocolRevision: number
      }
      readonly activeRuns: readonly StatusActiveRun[]
    }

export type HostProbe =
  | { readonly state: 'not-running' }
  | {
      readonly state: 'upgrade-pending'
      readonly hostInstanceId: string
      readonly blockingRuns: number
    }
  | { readonly state: 'running'; readonly hostInstanceId: string; readonly revision: number }

/** Map with at most `limit` operations in flight, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  operation: (item: T) => Promise<R>,
) {
  const results: R[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item !== undefined) results[index] = await operation(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / MILLISECONDS_PER_SECOND))
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s`
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  return `${hours}h ${minutes % MINUTES_PER_HOUR}m`
}

function waitingNote(pendingQuestions: number | null) {
  if (pendingQuestions === null) return ', pending questions unknown'
  if (pendingQuestions === 0) return ''
  return `, waiting for ${pendingQuestions === 1 ? 'an answer' : `${pendingQuestions} answers`}`
}

export function formatStatusReport(report: StatusReport, now: number) {
  const lines = [`OpenWaggle ${report.version}`]
  if (report.host.state === 'not-running') {
    lines.push('Session Host: not running (it starts automatically when needed)')
    return lines.join('\n')
  }
  if (report.host.state === 'upgrade-pending') {
    const blocking = report.host.blockingRuns
    lines.push(
      `Session Host: running an older version; it hands over to this version once ${blocking === 0 ? 'it is idle' : `its ${blocking === 1 ? 'active Run ends' : `${blocking} active Runs end`}`}`,
    )
    return lines.join('\n')
  }
  lines.push('Session Host: running')
  const activeRuns = 'activeRuns' in report ? report.activeRuns : []
  if (activeRuns.length === 0) {
    lines.push('Active runs: none')
    return lines.join('\n')
  }
  lines.push(`Active runs: ${activeRuns.length}`)
  for (const run of activeRuns) {
    lines.push(
      `  ${run.sessionId}  ${run.title === null ? '(Session details unavailable)' : singleLine(run.title)}  (${singleLine(run.model)}, ${formatDuration(now - run.startedAt)}${waitingNote(run.pendingQuestions)})`,
    )
    const where = run.projectPath ? `  in ${singleLine(run.projectPath)}` : ''
    lines.push(`    Run ${run.runId ?? 'unknown'}${where}`)
  }
  return lines.join('\n')
}
