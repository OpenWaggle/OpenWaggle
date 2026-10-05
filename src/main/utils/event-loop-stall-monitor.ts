import type { Logger } from '@shared/types/logger'

const DEFAULT_SAMPLE_INTERVAL_MS = 500
const DEFAULT_STALL_THRESHOLD_MS = 1_000
const DEFAULT_MIN_REPORT_INTERVAL_MS = 10_000

export interface EventLoopStallReport {
  /**
   * How long the loop was blocked beyond the sampling interval. Absent from a trailing summary,
   * which only reports the stalls the rate limit held back.
   */
  readonly stalledMs?: number
  /** Further stalls folded into this report by the rate limit since the previous one. */
  readonly suppressedStalls: number
  readonly longestSuppressedMs: number
}

export interface EventLoopStallMonitorInput {
  readonly logger: Pick<Logger, 'warn'>
  readonly message: string
  /** Bounded, already-redacted context about what the process was doing. */
  readonly describe?: () => object
  readonly sampleIntervalMs?: number
  readonly stallThresholdMs?: number
  readonly minReportIntervalMs?: number
  readonly now?: () => number
}

function describeContext(describe: (() => object) | undefined): object {
  try {
    return describe?.() ?? {}
  } catch (error) {
    return { describeError: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Logs when this process's event loop was blocked for longer than a threshold.
 *
 * A blocked loop is invisible from inside: nothing else runs, so nothing logs. Clients see only
 * their own timeouts. This sampler notices afterwards from how late its timer fired, and records
 * the stall with whatever context `describe` can give, so a later report says which process
 * stalled, for how long, and what was in flight. Reports are rate limited; stalls held back are
 * counted into the next report, or into a trailing summary once the interval passes without one.
 * The timer is unreferenced so it never keeps the process alive.
 */
export function startEventLoopStallMonitor(input: EventLoopStallMonitorInput): () => void {
  const now = input.now ?? (() => performance.now())
  const intervalMs = input.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS
  const thresholdMs = input.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS
  const minReportIntervalMs = input.minReportIntervalMs ?? DEFAULT_MIN_REPORT_INTERVAL_MS
  let previous = now()
  let lastReportAt = Number.NEGATIVE_INFINITY
  let suppressedStalls = 0
  let longestSuppressedMs = 0

  const emit = (at: number, stalledMs: number | undefined, context: object) => {
    const stall: EventLoopStallReport = {
      ...(stalledMs === undefined ? {} : { stalledMs: Math.round(stalledMs) }),
      suppressedStalls,
      longestSuppressedMs: Math.round(longestSuppressedMs),
    }
    input.logger.warn(input.message, { ...stall, ...context })
    lastReportAt = at
    suppressedStalls = 0
    longestSuppressedMs = 0
  }

  const report = (stalledMs: number, at: number) => {
    if (at - lastReportAt < minReportIntervalMs) {
      suppressedStalls += 1
      longestSuppressedMs = Math.max(longestSuppressedMs, stalledMs)
      return
    }
    emit(at, stalledMs, describeContext(input.describe))
  }

  const timer = setInterval(() => {
    const current = now()
    const stalledMs = current - previous - intervalMs
    previous = current
    if (stalledMs >= thresholdMs) {
      report(stalledMs, current)
      return
    }
    if (suppressedStalls > 0 && current - lastReportAt >= minReportIntervalMs) {
      // Without this, stalls after the last report stayed unlogged until another stall came.
      // The context now describes the present, not the stalls, so it is left out.
      emit(current, undefined, {})
    }
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
