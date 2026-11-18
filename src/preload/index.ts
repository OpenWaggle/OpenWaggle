import { api } from './api'
import { exposeInMainWorld } from './electron-transport'
import { exposeErrorReportingBridge } from './error-reporting-bridge'

/**
 * Expose the typed API to the renderer process.
 * Access it via `window.api` in React.
 */
exposeInMainWorld('api', api)
exposeErrorReportingBridge(process.argv)
