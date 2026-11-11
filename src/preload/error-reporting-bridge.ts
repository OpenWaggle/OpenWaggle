import { ERROR_REPORTING_RENDERER_SWITCH } from '@shared/error-reporting/error-report-constants'
import { ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL } from '@shared/error-reporting/error-report-envelope-bridge'
import { exposeInMainWorld } from './transport'

/**
 * The preload's error-report bridge (ADR 0045, 0064). The renderer's browser SDK hands each
 * envelope to `window.api.sendErrorReportEnvelope`, so the bridge is only the marker that tells
 * the renderer to start that SDK. It exists only when the main process passed the
 * error-reporting switch; without it the renderer SDK never starts.
 */
export function exposeErrorReportingBridge(argv: readonly string[]) {
  if (!argv.includes(ERROR_REPORTING_RENDERER_SWITCH)) return false
  exposeInMainWorld(ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL, true)
  return true
}
