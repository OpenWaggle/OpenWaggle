import { api } from './api'
import { applyPendingElectronLocalStorageImport } from './electron-local-storage-import'
import { exposeInMainWorld, rendererArguments, send, sendFirstFrame } from './transport'
import { exposeErrorReportingBridge } from './error-reporting-bridge'
import { reportFirstFrame } from './first-frame'
import { installIdleCallbackPolyfill } from './idle-callback-polyfill'

// Before the renderer's modules run: libraries call requestIdleCallback unguarded.
installIdleCallbackPolyfill(window)

// Before the renderer's modules run: they read localStorage when they load.
applyPendingElectronLocalStorageImport(
  rendererArguments(),
  send('electron-migration:local-storage-applied'),
)

/**
 * Expose the typed API to the renderer process.
 * Access it via `window.api` in React.
 */
exposeInMainWorld('api', api)
exposeErrorReportingBridge(rendererArguments())

// The window is shown once its startup frame can be.
reportFirstFrame(document, sendFirstFrame)
