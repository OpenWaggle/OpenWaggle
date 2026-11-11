import {
  ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL,
  ERROR_REPORTING_RENDERER_SWITCH,
} from '@shared/error-reporting/error-report-constants'
import { exposeInMainWorld } from './electron-transport'

/**
 * The Electrobun preload's error-report bridge (ADR 0045, 0064), which
 * `scripts/build-electrobun-preload.ts` bundles in place of `error-reporting-bridge.ts` (and
 * `./electron-transport` with it). The Electron bridge is the Sentry Electron SDK's
 * `contextBridge` hookup, which needs Electron's IPC. Here the renderer's browser SDK hands each
 * envelope to `window.api.sendErrorReportEnvelope`, so the bridge is only the marker that tells
 * the renderer to start that SDK. As on Electron, it exists only when the main process passed the
 * error-reporting switch; without it the renderer SDK never starts.
 */
export function exposeErrorReportingBridge(argv: readonly string[]) {
  if (!argv.includes(ERROR_REPORTING_RENDERER_SWITCH)) return false
  exposeInMainWorld(ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL, true)
  return true
}
