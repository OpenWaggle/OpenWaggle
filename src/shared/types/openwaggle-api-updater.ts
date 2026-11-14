/**
 * Renderer-facing auto-updater API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit. Grouped because these five calls are
 * one lifecycle: read the current version and status, check, install, and subscribe to progress.
 */

import type { IpcEventMethod, IpcInvokeMethod } from './ipc-api-methods'

export interface OpenWaggleUpdaterApi {
  checkForUpdates: IpcInvokeMethod<'updater:check'>
  /** Restart to update; asks first when agent runs are active. */
  installUpdate: IpcInvokeMethod<'updater:install'>
  /** Restart now, stopping any active agent runs; ends a Restart when idle wait. */
  installUpdateNow: IpcInvokeMethod<'updater:install-now'>
  getUpdateStatus: IpcInvokeMethod<'updater:get-status'>
  getAppVersion: IpcInvokeMethod<'app:get-version'>
  onUpdateStatus: IpcEventMethod<'updater:status-changed'>
}
