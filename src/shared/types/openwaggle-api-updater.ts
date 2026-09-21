/**
 * Renderer-facing auto-updater API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit. Grouped because these five calls are
 * one lifecycle: read the current version and status, check, install, and subscribe to progress.
 */

import type { UpdateChannel } from './update-channel'
import type { UpdateStatus } from './updater'

export interface OpenWaggleUpdaterApi {
  checkForUpdates(channel?: UpdateChannel): Promise<void>
  installUpdate(): Promise<void>
  getUpdateStatus(): Promise<UpdateStatus>
  getAppVersion(): Promise<string>
  onUpdateStatus(callback: (payload: UpdateStatus) => void): () => void
}
