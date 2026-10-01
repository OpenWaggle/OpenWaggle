/**
 * Milliseconds on the process's monotonic clock. It never jumps with wall-clock changes and does
 * not advance while the machine sleeps, so leases measured on it survive a long sleep. Values are
 * meaningful only within this process.
 */
export function monotonicNowMs() {
  return performance.now()
}
