import { api } from './api'
import { applyPendingElectronLocalStorageImport } from './electron-local-storage-import'
import { exposeInMainWorld, rendererArguments, send } from './transport'
import { exposeErrorReportingBridge } from './error-reporting-bridge'

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
