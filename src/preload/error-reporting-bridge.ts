import { hookupIpc } from '@sentry/electron/preload-namespaced'
import { ERROR_REPORTING_RENDERER_SWITCH } from '@shared/error-reporting/error-report-constants'

/**
 * Exposes the Sentry SDK's IPC bridge (`window.__SENTRY_IPC__`) through `contextBridge`, which is
 * how a sandboxed, context-isolated renderer hands error reports to the main process. The page
 * never sends a report over the network, so its Content Security Policy needs no new source.
 *
 * The main process adds the switch to `process.argv` only when it may report errors: no fixed
 * opt-out applies, as one does for Dev builds, automation and the environment opt-outs, and its
 * SDK did not fail to start. Without it there is no bridge and the renderer SDK never starts.
 * Only the SDK's scope-to-main integration uses the bridge's `sendScope`; the renderer leaves it
 * out and the main process stops listening on that channel.
 */
export function exposeErrorReportingBridge(argv: readonly string[]) {
  if (!argv.includes(ERROR_REPORTING_RENDERER_SWITCH)) return false
  hookupIpc()
  return true
}
