/**
 * The Electrobun preload's stand-in for `error-reporting-bridge.ts` (ADR 0064), which
 * `scripts/build-electrobun-preload.ts` bundles in its place. The Electron bridge is the Sentry
 * Electron SDK's `contextBridge` hookup, which needs Electron's IPC; the Electrobun shell reports
 * renderer errors through its own main-process reporter, so the page gets no bridge and the
 * renderer SDK never starts, as when the main process passes no reporting switch.
 */
export function exposeErrorReportingBridge(_argv: readonly string[]) {
  return false
}
